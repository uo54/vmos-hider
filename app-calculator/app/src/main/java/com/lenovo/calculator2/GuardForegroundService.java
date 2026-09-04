package com.lenovo.calculator2;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 守护前台服务：
 * 让系统把“计算器(宿主)”视为活跃应用，设置里才会出现
 * 「允许后台运行 / 保持后台运行 / 无限制」之类的开关（用户手动点开，
 * 守护就不容易被 ZUI/省电策略掐死）。通知条低调、可划掉，进程靠本服务常驻。
 */
public class GuardForegroundService extends Service {

    public static final String CHANNEL_ID = "guard";
    private static final int NOTIFY_ID = 1955;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "守卫", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Notification n = buildNotification();
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFY_ID, n, type);
        } else {
            startForeground(NOTIFY_ID, n);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle(getString(R.string.notify_title))
                .setContentText(getString(R.string.notify_text))
                .setSmallIcon(android.R.drawable.ic_menu_manage)
                .setContentIntent(pi)
                .setOngoing(false)
                .setShowWhen(false)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY; // 被杀后系统自动重启
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** 由其它组件调用，确保前台服务在跑 */
    public static void ensureRunning(android.content.Context ctx) {
        try {
            Intent i = new Intent(ctx, GuardForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Throwable ignored) {
        }
    }
}
