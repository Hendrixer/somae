#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <Carbon/Carbon.h>
#import <objc/runtime.h>
#include <math.h>
#include <stdatomic.h>

// Reserve one chord with the window server. Unlike NSEvent key monitoring,
// RegisterEventHotKey needs no Accessibility permission and includes our app.
static EventHotKeyRef hotkey;
static EventHandlerRef handler;
static atomic_uint pending;
static atomic_uint pendingBeaconClicks;
static atomic_bool beaconHovered;
static const OSType signature = 0x534F4D41; // SOMA

static OSStatus pressed(EventHandlerCallRef next, EventRef event, void *context) {
    EventHotKeyID identifier;
    OSStatus result = GetEventParameter(event, kEventParamDirectObject,
        typeEventHotKeyID, NULL, sizeof(identifier), NULL, &identifier);
    if (result != noErr || identifier.signature != signature || identifier.id != 1)
        return eventNotHandledErr;
    atomic_fetch_add(&pending, 1);
    return noErr;
}

static void onMain(dispatch_block_t work) {
    if ([NSThread isMainThread]) work();
    else dispatch_sync(dispatch_get_main_queue(), work);
}

int somae_hotkey_start(void) {
    __block OSStatus result = noErr;
    onMain(^{
        if (hotkey) { result = eventHotKeyExistsErr; return; }
        EventTypeSpec type = { kEventClassKeyboard, kEventHotKeyPressed };
        result = InstallEventHandler(GetApplicationEventTarget(), pressed, 1,
            &type, NULL, &handler);
        if (result != noErr) return;
        EventHotKeyID identifier = { signature, 1 };
        result = RegisterEventHotKey(kVK_Space, cmdKey | shiftKey, identifier,
            GetApplicationEventTarget(), kEventHotKeyExclusive, &hotkey);
        if (result != noErr) {
            RemoveEventHandler(handler);
            handler = NULL;
        }
        atomic_store(&pending, 0);
    });
    return result;
}

unsigned int somae_hotkey_take(void) {
    // Bun consumes events on its own thread; no native-to-JS callback can race
    // shutdown or call WebKit from macOS's event thread.
    return atomic_exchange(&pending, 0);
}

int somae_hotkey_stop(void) {
    __block OSStatus result = noErr;
    onMain(^{
        if (hotkey) result = UnregisterEventHotKey(hotkey);
        hotkey = NULL;
        if (handler) RemoveEventHandler(handler);
        handler = NULL;
        atomic_store(&pending, 0);
    });
    return result;
}

// Electrobun's fully custom titlebar is borderless. Its transparent-window
// option removes the native shadow and does not round the content. Clip the
// actual AppKit surface, rather than merely drawing rounded HTML over an
// opaque rectangular window. The supplied pointer is BrowserWindow.ptr.
int somae_window_style(void *pointer, double radius, double minimumWidth,
    double minimumHeight) {
    if (!pointer || !isfinite(radius) || radius < 0 ||
        !isfinite(minimumWidth) || minimumWidth <= 0 ||
        !isfinite(minimumHeight) || minimumHeight <= 0) return paramErr;
    __block OSStatus result = noErr;
    onMain(^{
        NSWindow *window = (__bridge NSWindow *)pointer;
        NSView *content = window.contentView;
        if (!content) { result = paramErr; return; }
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        window.hasShadow = YES;
        window.contentMinSize = NSMakeSize(minimumWidth, minimumHeight);
        content.wantsLayer = YES;
        content.layer.opaque = NO;
        content.layer.backgroundColor = NSColor.clearColor.CGColor;
        content.layer.cornerRadius = radius;
        content.layer.cornerCurve = kCACornerCurveContinuous;
        content.layer.masksToBounds = YES;
        [window invalidateShadow];
    });
    return result;
}

static const void *expandedFrameKey = &expandedFrameKey;
static const void *compactFrameKey = &compactFrameKey;
static const void *windowMotionKey = &windowMotionKey;

// Keep the transition on AppKit's animation clock. JavaScript supplies one
// destination, never a stream of intermediate window sizes. Resize notices
// record actual AppKit progress without introducing a second animation timer.
@interface SomaeWindowMotion : NSObject
@property NSRect target;
@property BOOL hasTarget;
@property BOOL active;
@property NSUInteger generation;
@property NSUInteger starts;
@property NSUInteger completions;
@property NSUInteger frames;
@property CFTimeInterval started;
@property CFTimeInterval previousFrame;
@property CFTimeInterval elapsed;
@property CFTimeInterval maximumGap;
@property CFTimeInterval firstFrame;
@property CFTimeInterval maximumProgressGap;
@property CGFloat maximumProgressGapDistance;
@property CFTimeInterval maximumSignificantGap;
@property NSRect previousFrameRect;
@property NSTimeInterval duration;
@property (strong) CAMediaTimingFunction *timingFunction;
@property (strong) id observer;
@end

@implementation SomaeWindowMotion
- (void)dealloc {
    if (_observer) [NSNotificationCenter.defaultCenter removeObserver:_observer];
}
@end

static SomaeWindowMotion *motionForWindow(NSWindow *window) {
    SomaeWindowMotion *motion = objc_getAssociatedObject(window, windowMotionKey);
    if (motion) return motion;
    motion = [SomaeWindowMotion new];
    // Standalone native harnesses have no token module. The app configures
    // these values once from the canonical generated tokens through Bun FFI.
    motion.duration = 0.33;
    motion.timingFunction = [CAMediaTimingFunction
        functionWithControlPoints:0.16 :1.0 :0.3 :1.0];
    __weak SomaeWindowMotion *weakMotion = motion;
    motion.observer = [NSNotificationCenter.defaultCenter
        addObserverForName:NSWindowDidResizeNotification object:window queue:nil
        usingBlock:^(NSNotification *notice) {
            SomaeWindowMotion *current = weakMotion;
            if (!current.active) return;
            CFTimeInterval now = CACurrentMediaTime();
            current.frames++;
            NSRect rect = [(NSWindow *)notice.object frame];
            NSRect prior = current.previousFrameRect;
            CGFloat distance = MAX(MAX(fabs(NSMinX(rect) - NSMinX(prior)),
                fabs(NSMinY(rect) - NSMinY(prior))),
                MAX(fabs(NSWidth(rect) - NSWidth(prior)),
                    fabs(NSHeight(rect) - NSHeight(prior))));
            if (current.previousFrame) {
                CFTimeInterval gap = now - current.previousFrame;
                if (gap >= current.maximumProgressGap) {
                    current.maximumProgressGap = gap;
                    current.maximumProgressGapDistance = distance;
                }
                // AppKit rounds the last fraction of a point near this
                // fast-settling curve's end. A long notification gap while
                // almost stationary is different from a paused large move.
                if (distance > 2) current.maximumSignificantGap =
                    MAX(current.maximumSignificantGap, gap);
            } else current.firstFrame = now - current.started;
            current.maximumGap = MAX(current.maximumGap,
                now - (current.previousFrame ?: current.started));
            current.previousFrame = now;
            current.previousFrameRect = rect;
        }];
    objc_setAssociatedObject(window, windowMotionKey, motion,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return motion;
}

static BOOL nearFrame(NSRect left, NSRect right) {
    return fabs(left.origin.x - right.origin.x) < 0.5 &&
        fabs(left.origin.y - right.origin.y) < 0.5 &&
        fabs(left.size.width - right.size.width) < 0.5 &&
        fabs(left.size.height - right.size.height) < 0.5;
}

int somae_window_motion_configure(void *pointer, double duration,
    double x1, double y1, double x2, double y2) {
    if (!pointer || !isfinite(duration) || duration <= 0 ||
        !isfinite(x1) || x1 < 0 || x1 > 1 || !isfinite(y1) ||
        !isfinite(x2) || x2 < 0 || x2 > 1 || !isfinite(y2)) return paramErr;
    onMain(^{
        SomaeWindowMotion *motion = motionForWindow((__bridge NSWindow *)pointer);
        motion.duration = duration;
        motion.timingFunction = [CAMediaTimingFunction
            functionWithControlPoints:x1 :y1 :x2 :y2];
    });
    return noErr;
}

static void stopWindowMotion(NSWindow *window, SomaeWindowMotion *motion) {
    motion.generation++;
    motion.active = NO;
    // A zero-duration animator update replaces an in-flight AppKit frame
    // animation at its current position before a new destination is installed.
    NSRect current = window.frame;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0;
        [[window animator] setFrame:current display:NO];
    }];
}

int somae_window_resize(void *pointer, double width, double height, int expanded,
    int animate) {
    if (!pointer || !isfinite(width) || width <= 0 ||
        !isfinite(height) || height <= 0) return paramErr;
    onMain(^{
        NSWindow *window = (__bridge NSWindow *)pointer;
        SomaeWindowMotion *motion = motionForWindow(window);
        NSRect frame = window.frame;
        NSScreen *display = window.screen ?: NSScreen.mainScreen;
        if (!display) return;
        NSRect screen = display.visibleFrame;
        const BOOL wasExpanded = [objc_getAssociatedObject(window,
            expandedFrameKey) boolValue];
        if (expanded && !wasExpanded) {
            objc_setAssociatedObject(window, compactFrameKey,
                [NSValue valueWithRect:motion.active && motion.hasTarget ?
                    motion.target : frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        NSValue *compact = objc_getAssociatedObject(window, compactFrameKey);
        NSRect anchor = !expanded && wasExpanded && compact ? compact.rectValue :
            (motion.active && motion.hasTarget ? motion.target : frame);
        frame.size = NSMakeSize(MIN(MAX(width, window.contentMinSize.width),
            NSWidth(screen)), MIN(MAX(height, window.contentMinSize.height),
            NSHeight(screen)));
        if (expanded) {
            // An asset canvas belongs in the usable display's center, rather
            // than growing right/down from a small companion near an edge.
            // Center once on entry. Later content sizing preserves its current
            // center, including a position chosen by dragging the canvas.
            NSRect center = wasExpanded ? anchor : screen;
            frame.origin = NSMakePoint(NSMidX(center) - frame.size.width / 2,
                NSMidY(center) - frame.size.height / 2);
        } else {
            // Preserve the last compact header position after a canvas closes.
            frame.origin.x = anchor.origin.x;
            frame.origin.y = MIN(NSMaxY(anchor), NSMaxY(screen)) - frame.size.height;
        }
        frame.origin.y = MAX(NSMinY(screen), MIN(frame.origin.y,
            NSMaxY(screen) - frame.size.height));
        frame.origin.x = MAX(NSMinX(screen), MIN(frame.origin.x,
            NSMaxX(screen) - frame.size.width));
        objc_setAssociatedObject(window, expandedFrameKey, @(expanded != 0),
            OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        const BOOL shouldAnimate = animate && window.visible && motion.hasTarget &&
            !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
        // Browser resize observation can report the same destination while the
        // native frame is between endpoints. It must not restart the clock.
        if (motion.hasTarget && nearFrame(frame, motion.target) &&
            (shouldAnimate || !motion.active)) return;
        if (motion.active) stopWindowMotion(window, motion);
        motion.target = frame;
        motion.hasTarget = YES;
        if (!shouldAnimate || nearFrame(frame, window.frame)) {
            motion.active = NO;
            [window setFrame:frame display:NO animate:NO];
            [window invalidateShadow];
            return;
        }
        motion.active = YES;
        motion.starts++;
        motion.frames = 0;
        motion.previousFrame = 0;
        motion.elapsed = 0;
        motion.maximumGap = 0;
        motion.firstFrame = 0;
        motion.maximumProgressGap = 0;
        motion.maximumProgressGapDistance = 0;
        motion.maximumSignificantGap = 0;
        motion.previousFrameRect = window.frame;
        motion.started = CACurrentMediaTime();
        const NSUInteger generation = ++motion.generation;
        [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
            context.duration = motion.duration;
            context.timingFunction = motion.timingFunction;
            [[window animator] setFrame:frame display:NO];
        } completionHandler:^{
            if (motion.generation != generation) return;
            motion.elapsed = CACurrentMediaTime() - motion.started;
            motion.active = NO;
            motion.completions++;
            [window invalidateShadow];
        }];
    });
    return noErr;
}

// Fourteen doubles form a deliberately simple ABI shared with Bun. No native
// objects or callback pointers cross the process/view boundary.
int somae_window_motion_active(void *pointer) {
    if (!pointer) return 0;
    // The animation owns this associated state until window disposal. Reading
    // its atomic property needs no AppKit call or synchronous main-queue hop.
    // Completion polling must not contend with resize callbacks into Bun.
    SomaeWindowMotion *motion = objc_getAssociatedObject((__bridge id)pointer,
        windowMotionKey);
    return motion.active ? 1 : 0;
}

int somae_window_motion_state(void *pointer, double *values) {
    if (!pointer || !values) return paramErr;
    onMain(^{
        SomaeWindowMotion *motion = motionForWindow((__bridge NSWindow *)pointer);
        values[0] = motion.active ? 1 : 0;
        values[1] = motion.starts;
        values[2] = motion.completions;
        values[3] = motion.frames;
        values[4] = 1000 * (motion.active ? CACurrentMediaTime() - motion.started : motion.elapsed);
        values[5] = 1000 * motion.maximumGap;
        values[6] = motion.target.origin.x;
        values[7] = motion.target.origin.y;
        values[8] = motion.target.size.width;
        values[9] = motion.target.size.height;
        values[10] = 1000 * motion.firstFrame;
        values[11] = 1000 * motion.maximumProgressGap;
        values[12] = motion.maximumProgressGapDistance;
        values[13] = 1000 * motion.maximumSignificantGap;
    });
    return noErr;
}

// A normally allocated, owned control accepts the inactive beacon's first
// click. Never change an initialized WKWebView's Objective-C class: AppKit
// caches class-specific dynamic properties during initialization and tracking.
@interface SomaeBeaconButton : NSButton {
    NSTrackingArea *_beaconTracking;
}
@end

@implementation SomaeBeaconButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)isOpaque { return NO; }
- (void)drawRect:(NSRect)dirtyRect { /* HTML owns the material below us. */ }
- (void)openCompanion:(id)sender { atomic_fetch_add(&pendingBeaconClicks, 1); }
- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (_beaconTracking) [self removeTrackingArea:_beaconTracking];
    _beaconTracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingActiveAlways | NSTrackingMouseEnteredAndExited |
            NSTrackingInVisibleRect
        owner:self userInfo:nil];
    [self addTrackingArea:_beaconTracking];
}
- (void)mouseEntered:(NSEvent *)event { atomic_store(&beaconHovered, true); }
- (void)mouseExited:(NSEvent *)event { atomic_store(&beaconHovered, false); }
@end

static const void *beaconButtonKey = &beaconButtonKey;

int somae_window_beacon_style(void *pointer) {
    if (!pointer) return paramErr;
    onMain(^{
        NSWindow *window = (__bridge NSWindow *)pointer;
        window.level = NSFloatingWindowLevel;
        window.hidesOnDeactivate = NO;
        window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
            NSWindowCollectionBehaviorFullScreenAuxiliary |
            NSWindowCollectionBehaviorIgnoresCycle;
        if (!objc_getAssociatedObject(window, beaconButtonKey)) {
            NSView *content = window.contentView;
            const CGFloat grip = 21;
            SomaeBeaconButton *button = [[SomaeBeaconButton alloc]
                initWithFrame:NSMakeRect(grip, 0,
                    MAX(0, NSWidth(content.bounds) - grip), NSHeight(content.bounds))];
            button.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
            button.bordered = NO;
            button.identifier = @"somae.beacon.open";
            button.title = @"";
            button.focusRingType = NSFocusRingTypeNone;
            button.target = button;
            button.action = @selector(openCompanion:);
            // The HTML button retains its existing accessible/keyboard action.
            [button setAccessibilityElement:NO];
            button.accessibilityHidden = YES;
            button.accessibilityLabel = @"Open Somae";
            [content addSubview:button positioned:NSWindowAbove relativeTo:nil];
            objc_setAssociatedObject(window, beaconButtonKey, button,
                OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        atomic_store(&pendingBeaconClicks, 0);
        atomic_store(&beaconHovered, false);
    });
    return noErr;
}

unsigned int somae_beacon_state_take(void) {
    return (atomic_exchange(&pendingBeaconClicks, 0) & 0x7fffffffU) |
        (atomic_load(&beaconHovered) ? 0x80000000U : 0);
}

int somae_window_place_beacon(void *pointer) {
    if (!pointer) return paramErr;
    onMain(^{
        NSWindow *window = (__bridge NSWindow *)pointer;
        NSScreen *display = window.screen ?: NSScreen.mainScreen;
        NSPoint cursor = NSEvent.mouseLocation;
        for (NSScreen *candidate in NSScreen.screens) {
            if (NSPointInRect(cursor, candidate.frame)) { display = candidate; break; }
        }
        if (!display) return;
        NSRect usable = display.visibleFrame;
        NSRect frame = window.frame;
        frame.size.width = MIN(frame.size.width, NSWidth(usable));
        frame.size.height = MIN(frame.size.height, NSHeight(usable));
        frame.origin.x = NSMidX(usable) - frame.size.width / 2;
        frame.origin.y = MAX(NSMinY(usable), NSMaxY(usable) - frame.size.height - 18);
        [window setFrame:frame display:YES animate:NO];
        [window invalidateShadow];
        atomic_store(&beaconHovered, false);
    });
    return noErr;
}

int somae_window_is_key(void *pointer) {
    if (!pointer) return 0;
    __block int result = 0;
    onMain(^{ result = [(__bridge NSWindow *)pointer isKeyWindow] ? 1 : 0; });
    return result;
}

int somae_app_deactivate(void) {
    // Relinquish this application's focus after the companion is put away.
    // NSApp.hide would also hide the independently useful floating beacon.
    onMain(^{ [NSApplication.sharedApplication deactivate]; });
    return noErr;
}

static NSView *findWebContent(NSView *view, Class webViewClass) {
    if ([view isKindOfClass:webViewClass]) return view;
    for (NSView *child in view.subviews) {
        NSView *match = findWebContent(child, webViewClass);
        if (match) return match;
    }
    return nil;
}

int somae_window_focus_content(void *pointer) {
    if (!pointer) return paramErr;
    __block OSStatus result = noErr;
    onMain(^{
        NSWindow *window = (__bridge NSWindow *)pointer;
        // Electrobun's activateWindow makes the NSWindow key but does not
        // restore its web content as first responder after another window.
        // WKWebView is a public class already loaded by our native renderer.
        Class webViewClass = NSClassFromString(@"WKWebView");
        NSView *webContent = webViewClass ? findWebContent(window.contentView,
            webViewClass) : nil;
        if (!webContent) { result = paramErr; return; }
        [window makeKeyAndOrderFront:nil];
        [NSApplication.sharedApplication activateIgnoringOtherApps:YES];
        if (![window makeFirstResponder:webContent]) result = paramErr;
    });
    return result;
}
