package com.lenovo.calculator2;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

/**
 * 守卫监听：只要「系统桌面(com.vmos.pro)」的窗口不再是前台（用户 Home /
 * 划出 / 切走），稍作延迟后立即用 Dhizuku 把它整体挂起——
 * 任务、进程、最近任务卡片、冻结快照全部消失，且不会被它自己复活。
 *
 * 宽限期：计算器暗码启动后 7 秒内不判定“离开”，避免误挂。
 */
public class CalcAccessibilityService extends AccessibilityService {
    private static final String TAG = "CalcGuardA11y";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile String lastTop = null;
    private long lastEventMs = 0;
    private boolean pending = false;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        // 无障碍服务连上后，拉起前台服务让系统认可“常驻”，并初始化 Dhizuku
        GuardForegroundService.ensureRunning(getApplicationContext());
        Guardian.initDhizuku(this);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (SystemClock.elapsedRealtime() - lastEventMs < 150) return; // 防抖
        lastEventMs = SystemClock.elapsedRealtime();

        String top = event.getPackageName() == null ? null : event.getPackageName().toString();
        if (top == null) return;
        final String prev = lastTop;
        lastTop = top;

        if (Guardian.isInOpeningGrace()) return; // 计算器刚按下暗码，忽略

        boolean wasVmos = Guardian.TARGET_PKG.equals(prev);
        boolean isVmos = Guardian.TARGET_PKG.equals(top);
        if (wasVmos && !isVmos) {
            scheduleSuspend();
        } else if (isVmos) {
            cancelPending();
        }
    }

    private void scheduleSuspend() {
        if (pending) return;
        pending = true;
        final Context ctx = getApplicationContext();
        handler.postDelayed(() -> {
            pending = false;
            if (Guardian.isInOpeningGrace()) return;
            // 延迟后再确认：若期间又回到了目标窗口则放弃
            if (!Guardian.TARGET_PKG.equals(lastTop)) {
                Log.i(TAG, "target left foreground -> suspend");
                Guardian.suspend(ctx);
            }
        }, 1800);
    }

    private void cancelPending() {
        // 简单处理：下次事件会重新安排，这里直接清除 pending 标记
        pending = false;
    }

    @Override
    public void onInterrupt() {
    }
}
