#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static void check(BOOL condition, const char *message) {
    if (condition) return;
    fprintf(stderr, "Beacon regression failed: %s\n", message);
    exit(1);
}

static BOOL near(CGFloat left, CGFloat right) { return fabs(left - right) < 0.75; }

static void runFor(NSTimeInterval duration) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:duration];
    while (until.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:
            [NSDate dateWithTimeIntervalSinceNow:MIN(0.005, until.timeIntervalSinceNow)]];
    }
}

static id evaluate(WKWebView *web, NSString *script) {
    __block BOOL complete = NO;
    __block id result;
    __block NSError *failure;
    [web evaluateJavaScript:script completionHandler:^(id value, NSError *error) {
        result = value;
        failure = error;
        complete = YES;
    }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (!complete && deadline.timeIntervalSinceNow > 0) runFor(0.005);
    if (failure) fprintf(stderr, "WebKit layout regression: %s\n", failure.description.UTF8String);
    check(complete && !failure, "evaluate layout regression in the real system webview");
    return result;
}

static void checkLayout(NSString *directory) {
    NSError *error;
    NSString *css = [NSString stringWithContentsOfFile:[directory stringByAppendingPathComponent:
        @"src/view/app.css"] encoding:NSUTF8StringEncoding error:&error];
    check(css != nil, "read the real companion stylesheet for layout regression");
    NSString *tokens = [NSString stringWithContentsOfFile:[directory stringByAppendingPathComponent:
        @"../../packages/design-system/dist/tokens.css"] encoding:NSUTF8StringEncoding error:&error];
    check(tokens != nil, "read canonical token CSS for layout regression");
    NSString *source = [NSString stringWithContentsOfFile:[directory stringByAppendingPathComponent:
        @"src/view/layout.js"] encoding:NSUTF8StringEncoding error:&error];
    check(source != nil, "read the real companion measurement module");
    source = [source stringByReplacingOccurrencesOfString:@"export function fitCompanion"
        withString:@"function fitCompanion"];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1180, 700)
        styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [window.contentView addSubview:web];
    NSString *html = [NSString stringWithFormat:
        @"<!doctype html><html data-theme='electric'><style>%@\n%@</style>"
        @"<body><div class='app-shell'><header id='header'>Somae</header>"
        @"<main id='main' data-view='review'><div class='review-top'><h1 class='review-title'>Image review</h1></div>"
        @"<div class='review-layout'><div class='canvas'><div class='asset-tabs'><button>Image</button></div>"
        @"<div class='image-stage'><div class='image-surface'><img id='artifact-image' width='640' height='360' "
        @"src='data:image/svg+xml,%%3Csvg%%20xmlns=%%22http://www.w3.org/2000/svg%%22%%20width=%%22640%%22%%20height=%%22360%%22/%%3E'>"
        @"</div></div><div class='image-help'>Click to comment</div></div>"
        @"<aside class='review-aside'><div class='review-aside-header'><h2>Comments</h2></div>"
        @"<div class='review-body'><div class='comment-card'>A saved comment.</div></div>"
        @"<div class='review-dock'><div class='review-decisions'><button>Disapprove</button><button>Approve</button></div></div>"
        @"</aside></div></main><dialog id='dialog'></dialog></div></body></html>", tokens, css];
    [web loadHTMLString:html baseURL:nil];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (web.loading && deadline.timeIntervalSinceNow > 0) runFor(0.005);
    check(!web.loading, "load the isolated real-CSS review fixture");
    evaluate(web, [source stringByAppendingString:
        @"\nwindow.destinations=[];window.fit=fitCompanion({main:document.querySelector('#main'),"
        @"header:document.querySelector('#header'),dialog:document.querySelector('#dialog'),"
        @"request:(path,value)=>{destinations.push(value);return Promise.resolve();}});null;"]);
    runFor(0.2);
    NSNumber *first = evaluate(web, @"destinations[0]?.height");
    check(first.doubleValue > 400, "review fixture produces a meaningful intrinsic destination");
    for (NSNumber *height in @[@900, @420, @700]) {
        [window setContentSize:NSMakeSize(1180, height.doubleValue)];
        evaluate(web, @"window.dispatchEvent(new Event('somae:layout-settled'));fit();");
        runFor(0.2);
    }
    check([evaluate(web, @"destinations.length===1") boolValue],
        "viewport changes and repeated native settling do not feed back into review height");
    evaluate(web, @"document.querySelector('.review-body').append(Object.assign(document.createElement('div'),{textContent:'A long review comment',style:'height:900px'}));");
    runFor(0.2);
    check([evaluate(web, @"destinations.length===2 && destinations[1].height > destinations[0].height && destinations[1].height===1000") boolValue],
        "real review content growth still requests a larger capped destination");
    evaluate(web, @"document.querySelector('.review-dock').innerHTML='<fieldset class=review-question-answers><label class=review-answer-option><input id=answer-one type=radio name=answer value=one checked>One</label><label class=review-answer-option><input id=answer-two type=radio name=answer value=two>Two</label></fieldset>';fit();");
    runFor(0.2);
    check([evaluate(web, @"document.querySelector('#answer-one').checked") boolValue],
        "hidden measurement preserves the first question choice");
    evaluate(web, @"document.querySelector('#answer-two').checked=true;fit();");
    runFor(0.2);
    check([evaluate(web, @"document.querySelector('#answer-two').checked && !document.querySelector('#answer-one').checked") boolValue],
        "repeated measurement preserves the person's changed question choice");
    check([evaluate(web, @"document.querySelector('#answer-two').getBoundingClientRect().height===14") boolValue],
        "question radios keep their intended compact geometry");
    check(!window.visible && !window.keyWindow, "layout regression never displays or activates its window");
    [window close];
}

static void checkMotion(void *bridge) {
    int (*style)(void *, double, double, double) = dlsym(bridge, "somae_window_style");
    int (*resize)(void *, double, double, int, int) = dlsym(bridge, "somae_window_resize");
    int (*state)(void *, double *) = dlsym(bridge, "somae_window_motion_state");
    int (*active)(void *) = dlsym(bridge, "somae_window_motion_active");
    int (*configure)(void *, double, double, double, double, double) =
        dlsym(bridge, "somae_window_motion_configure");
    check(style && resize && state && active && configure,
        "load native motion entry points");
    NSScreen *display = NSScreen.mainScreen;
    NSRect screen = display.visibleFrame;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:
        NSMakeRect(NSMidX(screen) - 340, NSMidY(screen) - 180, 680, 360)
        styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [window.contentView addSubview:web];
    Class webClass = object_getClass(web);
    check(style((__bridge void *)window, 15, 480, 260) == 0, "style motion-test companion");
    check(configure((__bridge void *)window, 0.33, 0.16, 1, 0.3, 1) == 0,
        "configure native motion with the canonical resize duration and easing");
    check(configure((__bridge void *)window, NAN, 0.16, 1, 0.3, 1) != 0 &&
        configure((__bridge void *)window, 0, 0.16, 1, 0.3, 1) != 0 &&
        configure((__bridge void *)window, 0.33, -1, 1, 0.3, 1) != 0 &&
        configure((__bridge void *)window, 0.33, 0.16, 1, 0.3, INFINITY) != 0,
        "reject invalid duration and cubic-bezier controls without changing motion");
    check(resize((__bridge void *)window, 680, 360, 0, 1) == 0,
        "initial hidden sizing is immediate despite animation preference");
    double metrics[14] = {0};
    state((__bridge void *)window, metrics);
    check(metrics[0] == 0 && metrics[1] == 0, "hidden sizing does not start an animation");
    NSRect compact = window.frame;
    // Order an entirely transparent, nonactivating window so AppKit exercises
    // its actual visible-window animator without showing UI or taking focus.
    window.alphaValue = 0;
    [window orderBack:nil];
    check(window.visible && !window.keyWindow, "motion harness never acquires keyboard focus");
    NSResponder *responder = window.firstResponder;
    const BOOL reduced = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    check(resize((__bridge void *)window, 1180, 820, 1, 1) == 0, "request native animation");
    state((__bridge void *)window, metrics);
    if (reduced) {
        check(metrics[0] == 0 && metrics[1] == 0, "system Reduce Motion bypasses animation");
        [window close];
        return;
    }
    check(metrics[0] == 1 && metrics[1] == 1, "one native animation starts for a new target");
    check(active((__bridge void *)window) == 1, "lightweight completion polling observes active motion");
    runFor(0.12);
    NSRect intermediate = window.frame;
    check(NSWidth(intermediate) > NSWidth(compact) &&
        NSWidth(intermediate) < MIN(1180, NSWidth(screen)),
        "window has a genuine intermediate frame during the transition");
    check(resize((__bridge void *)window, 1180, 820, 1, 1) == 0,
        "repeat the browser's same destination during animation");
    state((__bridge void *)window, metrics);
    check(metrics[1] == 1, "duplicate destinations do not restart the animation clock");
    runFor(0.4);
    state((__bridge void *)window, metrics);
    check(metrics[0] == 0 && metrics[2] == 1, "native animation completes once");
    check(active((__bridge void *)window) == 0, "lightweight completion polling observes settled motion");
    check(metrics[3] >= 8 && metrics[5] < 160,
        "AppKit delivers multiple progressing frames without second-long gaps");
    check(metrics[10] > 0 && metrics[10] < 160 && metrics[11] > 0 && metrics[11] < 100,
        "record startup latency separately from gaps between progressing frames");
    check(metrics[12] >= 0 && metrics[13] > 0 && metrics[13] <= metrics[11] && metrics[13] < 80,
        "associate the longest progress gap with its movement and measure significant motion separately");
    check(metrics[4] >= 200 && metrics[4] < 700, "native animation settles near its 330ms duration");
    check(near(NSWidth(window.frame), MIN(1180, NSWidth(screen))) &&
        near(NSMidX(window.frame), NSMidX(screen)) && near(NSMidY(window.frame), NSMidY(screen)),
        "animation finishes exactly centered at its destination");
    printf("Native motion: %.0f frames, %.1fms elapsed, %.1fms first frame, %.1fms maximum progress gap (%.2fpt), %.1fms significant-motion gap.\n",
        metrics[3], metrics[4], metrics[10], metrics[11], metrics[12], metrics[13]);

    // Interrupt a collapse with a new expanded destination. Old completions
    // cannot settle or move the replacement transition.
    check(resize((__bridge void *)window, 680, 360, 0, 1) == 0, "begin animated compact return");
    runFor(0.09);
    NSRect before = window.frame;
    check(resize((__bridge void *)window, 900, 600, 1, 1) == 0, "retarget an interrupted transition");
    NSRect after = window.frame;
    check(fabs(NSWidth(before) - NSWidth(after)) < 2,
        "retargeting begins at the current frame without a size jump");
    runFor(0.5);
    state((__bridge void *)window, metrics);
    check(metrics[0] == 0 && metrics[1] == 3 && metrics[2] == 2,
        "interrupted completion cannot settle the replacement animation");
    check(near(NSWidth(window.frame), MIN(900, NSWidth(screen))) &&
        near(NSHeight(window.frame), MIN(600, NSHeight(screen))),
        "interruption ends at the newest destination");
    check(resize((__bridge void *)window, 680, 360, 0, 1) == 0, "animate compact restoration");
    runFor(0.5);
    check(near(NSMinX(window.frame), NSMinX(compact)) &&
        near(NSMaxY(window.frame), NSMaxY(compact)),
        "compact anchor survives interrupted expand/collapse");
    check(resize((__bridge void *)window, 1180, 820, 1, 1) == 0, "start transition before reducing motion");
    runFor(0.08);
    check(resize((__bridge void *)window, 1180, 820, 1, 0) == 0,
        "local Reduce Motion immediately settles an in-flight destination");
    state((__bridge void *)window, metrics);
    check(metrics[0] == 0 && near(NSWidth(window.frame), MIN(1180, NSWidth(screen))),
        "explicit immediate resize cancels native motion at the final geometry");
    runFor(0.4);
    check(near(NSWidth(window.frame), MIN(1180, NSWidth(screen))),
        "cancelled native callbacks never overwrite the settled frame");
    check(!window.keyWindow, "motion checks never activate their native window");
    check(object_getClass(web) == webClass && window.firstResponder == responder,
        "native frame motion preserves WebKit identity and native focus");
    [window close];
}

static void checkFrames(void *bridge) {
    int (*style)(void *, double, double, double) = dlsym(bridge, "somae_window_style");
    int (*resize)(void *, double, double, int, int) = dlsym(bridge, "somae_window_resize");
    check(style && resize, "load native frame entry points");
    NSScreen *display = NSScreen.mainScreen;
    check(display != nil, "native frame checks need an attached display");
    NSRect screen = display.visibleFrame;
    CGFloat width = MIN(680, NSWidth(screen));
    CGFloat height = MIN(360, NSHeight(screen));
    NSRect compact = NSMakeRect(NSMinX(screen) + MIN(80, NSWidth(screen) - width),
        NSMaxY(screen) - height - MIN(60, NSHeight(screen) - height), width, height);
    NSWindow *window = [[NSWindow alloc] initWithContentRect:compact
        styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    check(style((__bridge void *)window, 15, 480, 260) == 0, "style frame-test companion");
    compact = window.frame;
    check(resize((__bridge void *)window, 1180, 820, 1, 0) == 0, "expand a compact companion");
    NSRect expanded = window.frame;
    check(near(NSWidth(expanded), MIN(1180, NSWidth(screen))) &&
        near(NSHeight(expanded), MIN(820, NSHeight(screen))),
        "frame reaches final expanded size before resize returns");
    check(near(NSMidX(expanded), NSMidX(screen)) &&
        near(NSMidY(expanded), NSMidY(screen)),
        "expanded canvas centers on the display's usable frame");
    check(resize((__bridge void *)window, 900, 600, 1, 0) == 0, "resize an already expanded canvas");
    NSRect changed = window.frame;
    check(near(NSWidth(changed), MIN(900, NSWidth(screen))) &&
        near(NSHeight(changed), MIN(600, NSHeight(screen))) &&
        near(NSMidX(changed), NSMidX(screen)) && near(NSMidY(changed), NSMidY(screen)),
        "expanded size changes snap to a centered final frame");
    NSRect moved = changed;
    moved.origin.x = MAX(NSMinX(screen), moved.origin.x - 55);
    moved.origin.y = MIN(NSMaxY(screen) - moved.size.height, moved.origin.y + 30);
    [window setFrame:moved display:NO];
    check(resize((__bridge void *)window, 900, 600, 1, 0) == 0,
        "repeat a destination after a person moves the expanded canvas");
    check(near(NSMinX(window.frame), NSMinX(moved)) && near(NSMinY(window.frame), NSMinY(moved)),
        "a repeated destination never snaps a moved canvas back to screen center");
    check(resize((__bridge void *)window, 880, 580, 1, 0) == 0,
        "resize content after moving an expanded canvas");
    check(near(NSMidX(window.frame), NSMidX(moved)) && near(NSMidY(window.frame), NSMidY(moved)),
        "content growth and shrink retain the moved canvas center");
    check(resize((__bridge void *)window, width, height, 0, 0) == 0, "return to compact view");
    NSRect restored = window.frame;
    check(near(NSMinX(restored), NSMinX(compact)) &&
        near(NSMaxY(restored), NSMaxY(compact)),
        "compact return restores its prior header position");
    check(resize((__bridge void *)window, NSWidth(screen) * 2, NSHeight(screen) * 2, 1, 0) == 0,
        "accept a canvas larger than the display");
    NSRect capped = window.frame;
    check(near(NSMinX(capped), NSMinX(screen)) && near(NSMinY(capped), NSMinY(screen)) &&
        near(NSWidth(capped), NSWidth(screen)) && near(NSHeight(capped), NSHeight(screen)),
        "both canvas dimensions and origins stay inside the usable display");
    check(resize((__bridge void *)window, width, height, 0, 0) == 0, "restore compact after screen cap");
    check(near(NSMinX(window.frame), NSMinX(compact)) &&
        near(NSMaxY(window.frame), NSMaxY(compact)), "oversized canvas preserves compact position");
    check(resize((__bridge void *)window, NAN, height, 0, 0) != 0,
        "reject non-finite geometry without moving the window");
    check(!window.visible && !window.keyWindow, "frame regression never shows or focuses a window");
    [window close];
}

static NSArray<NSButton *> *beaconButtons(NSView *content) {
    NSMutableArray<NSButton *> *buttons = [NSMutableArray array];
    for (NSView *view in content.subviews) {
        if ([view isKindOfClass:NSButton.class] &&
            [view.identifier isEqualToString:@"somae.beacon.open"])
            [buttons addObject:(NSButton *)view];
    }
    return buttons;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        check(argc == 3, "supply the compiled native bridge path and desktop source directory");
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        void *bridge = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
        check(bridge != NULL, "load the actual app bridge");
        int (*style)(void *) = dlsym(bridge, "somae_window_beacon_style");
        unsigned int (*take)(void) = dlsym(bridge, "somae_beacon_state_take");
        check(style != NULL && take != NULL, "load the beacon entry points");

        // This window stays hidden and never takes focus or posts OS input.
        NSWindow *window = [[NSWindow alloc] initWithContentRect:
            NSMakeRect(0, 0, 268, 48) styleMask:NSWindowStyleMaskBorderless
            backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed = NO;
        NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 268, 48)];
        window.contentView = content;
        WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
        WKWebView *web = [[WKWebView alloc] initWithFrame:content.bounds
            configuration:configuration];
        web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [content addSubview:web];
        Class contentClass = object_getClass(content);
        Class webClass = object_getClass(web);
        check(style((__bridge void *)window) == 0, "style an owned WebKit window");
        check(object_getClass(content) == contentClass &&
            object_getClass(web) == webClass,
            "never change initialized AppKit or WKWebView class identity");
        NSArray<NSButton *> *buttons = beaconButtons(content);
        check(buttons.count == 1, "attach one normally allocated native button");
        NSButton *button = buttons.firstObject;
        check([button isKindOfClass:NSButton.class], "overlay inherits native button behavior");
        check(button.accessibilityHidden, "native overlay stays hidden behind the HTML accessible button");
        check([button.accessibilityLabel isEqualToString:@"Open Somae"],
            "native accessibility fallback never exposes the internal identifier");
        check(style((__bridge void *)window) == 0 && beaconButtons(content).count == 1,
            "repeat styling without adding duplicate controls");
        check(object_getClass(web) == webClass, "repeat styling leaves WebKit intact");
        check(!window.visible && !window.keyWindow, "test never shows or activates its window");

        NSEvent *entered = [NSEvent enterExitEventWithType:NSEventTypeMouseEntered
            location:NSMakePoint(100, 24) modifierFlags:0 timestamp:0
            windowNumber:window.windowNumber context:nil eventNumber:1
            trackingNumber:0 userData:NULL];
        NSEvent *exited = [NSEvent enterExitEventWithType:NSEventTypeMouseExited
            location:NSMakePoint(0, 0) modifierFlags:0 timestamp:0
            windowNumber:window.windowNumber context:nil eventNumber:2
            trackingNumber:0 userData:NULL];
        check([button acceptsFirstMouse:entered], "inactive beacon accepts its first click");
        check(!button.acceptsFirstResponder, "beacon does not steal keyboard focus");
        check([content hitTest:NSMakePoint(100, 24)] == button,
            "native click target covers the beacon body");
        check([content hitTest:NSMakePoint(5, 24)] != button,
            "keep the existing drag grip outside the button");

        // Exercise real NSView tracking setup repeatedly. The former runtime
        // WKWebView class swap aborted in AppKit's cached tracking properties.
        for (int iteration = 0; iteration < 3; iteration++) [button updateTrackingAreas];
        check(button.trackingAreas.count == 1, "replace rather than duplicate hover tracking");
        NSTrackingAreaOptions tracking = button.trackingAreas.firstObject.options;
        check((tracking & NSTrackingActiveAlways) &&
            (tracking & NSTrackingMouseEnteredAndExited) &&
            (tracking & NSTrackingInVisibleRect), "track hover while app is inactive");
        [button mouseEntered:entered];
        check(take() == 0x80000000U, "hover enters without inventing a click");
        [button performClick:nil];
        check(take() == 0x80000001U, "native button action queues one click and retains hover");
        check(take() == 0x80000000U, "reading drains clicks exactly once");
        [button mouseExited:exited];
        check(take() == 0, "hover exit clears the shared state");
        [button performClick:nil];
        [button performClick:nil];
        check(take() == 2 && take() == 0, "accumulate and atomically drain queued clicks");
        check(object_getClass(web) == webClass, "hover and clicks preserve WebKit class identity");
        [window close];
        checkFrames(bridge);
        checkMotion(bridge);
        checkLayout([NSString stringWithUTF8String:argv[2]]);
        // Keep the Objective-C class image loaded until the process exits.
        // Its controls can still be released by AppKit during pool draining.
        puts("Beacon native regression passed: WebKit identity, first click, hover queue, stable intrinsic layout, native frame motion and movable centered canvases.");
    }
    return 0;
}
