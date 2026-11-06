#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <stdatomic.h>
#include <string.h>

// Negative values are our unavailable/requesting/error states. Nonnegative
// values match UNAuthorizationStatus. This never asks for permission at boot.
static atomic_int permission = -1;
static atomic_bool mainVisible = true;
static UNUserNotificationCenter *notificationCenter;
static NSString *pendingSignal;
static NSObject *notificationLock;

@interface SomaeNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation SomaeNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    willPresentNotification:(UNNotification *)notification
    withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    completionHandler(atomic_load(&mainVisible) ? UNNotificationPresentationOptionNone :
        UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
    withCompletionHandler:(void (^)(void))completionHandler {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        @synchronized(notificationLock) { pendingSignal = response.notification.request.identifier; }
    }
    completionHandler();
}
@end
static SomaeNotificationDelegate *notificationDelegate;

int somae_notifications_start(void) {
    @try {
        // Running a standalone Bun/test binary must not impersonate an app or
        // invoke UserNotifications' bundle assertion. The signed app owns this.
        NSBundle *bundle = NSBundle.mainBundle;
        if (![bundle.bundleURL.pathExtension isEqualToString:@"app"] || !bundle.bundleIdentifier.length) return -1;
        if (notificationCenter) return atomic_load(&permission);
        notificationLock = [NSObject new];
        notificationCenter = UNUserNotificationCenter.currentNotificationCenter;
        notificationDelegate = [SomaeNotificationDelegate new];
        notificationCenter.delegate = notificationDelegate;
        [notificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
            atomic_store(&permission, (int)settings.authorizationStatus);
        }];
    } @catch (NSException *exception) { atomic_store(&permission, -1); }
    return atomic_load(&permission);
}
int somae_notifications_status(void) {
    // Reflect permission changes made in System Settings without asking again.
    if (notificationCenter && atomic_load(&permission) != -2)
        [notificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
            if (atomic_load(&permission) != -2) atomic_store(&permission, (int)settings.authorizationStatus);
        }];
    return atomic_load(&permission);
}
void somae_notifications_visible(int visible) { atomic_store(&mainVisible, visible != 0); }
int somae_notifications_request(void) {
    if (!notificationCenter) return -1;
    if (atomic_load(&permission) == -2) return -2;
    atomic_store(&permission, -2);
    [notificationCenter requestAuthorizationWithOptions:UNAuthorizationOptionAlert
        completionHandler:^(BOOL granted, NSError *error) {
            if (error) { atomic_store(&permission, -3); return; }
            [notificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
                atomic_store(&permission, (int)settings.authorizationStatus);
            }];
        }];
    return atomic_load(&permission);
}
int somae_notifications_post(const char *identifier, const char *title, const char *body) {
    if (!notificationCenter || !identifier || !title || !body ||
        atomic_load(&mainVisible) || (atomic_load(&permission) != UNAuthorizationStatusAuthorized &&
        atomic_load(&permission) != UNAuthorizationStatusProvisional)) return -1;
    NSString *signal = [NSString stringWithUTF8String:identifier];
    NSString *sender = [NSString stringWithUTF8String:title];
    NSString *message = [NSString stringWithUTF8String:body];
    if (!signal.length || signal.length > 512 || !sender || !message) return -1;
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = sender;
    content.body = message;
    content.threadIdentifier = @"somae-signals";
    // Silent by default, and no badge count that can drift from the live inbox.
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:signal content:content trigger:nil];
    [notificationCenter addNotificationRequest:request withCompletionHandler:^(NSError *error) {
        if (error) atomic_store(&permission, -3);
    }];
    return 0;
}
int somae_notifications_take(char *buffer, unsigned int capacity) {
    if (!buffer || capacity < 2 || !notificationLock) return 0;
    @synchronized(notificationLock) {
        const char *value = pendingSignal.UTF8String;
        if (!value) return 0;
        size_t length = strlen(value);
        if (length >= capacity) { pendingSignal = nil; return 0; }
        memcpy(buffer, value, length + 1);
        pendingSignal = nil;
        return (int)length;
    }
}
