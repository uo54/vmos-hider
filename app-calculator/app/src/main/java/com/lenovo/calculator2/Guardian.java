package com.lenovo.calculator2;

import android.annotation.SuppressLint;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import com.rosan.dhizuku.api.Dhizuku;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Guardian：用 Dhizuku（设备所有者）的能力对目标 App 做“挂起/解挂”。
 * 挂起 = 系统级冻结：任务、进程、最近任务卡片、残留快照全部立即消失；
 * 解挂后即可正常启动（冷启动）。
 *
 * 原理（与 InstallerX 同款）：把 device_policy 的 Binder 交给 Dhizuku 包装，
 * 让设备所有者身份替我们执行 DevicePolicyManager#setPackagesSuspended。
 */
public final class Guardian {
    private static final String TAG = "CalcGuard";
    /** 被守护的目标：伪装后的 VMOS */
    public static final String TARGET_PKG = "com.vmos.pro";

    // 计算器暗码按下后的一段时间内不做“离开即挂起”判断
    private static volatile long openingUntil = 0L;

    private Guardian() {}

    public static void markOpening() {
        openingUntil = System.currentTimeMillis() + 7000;
    }

    private static boolean insideOpeningWindow() {
        return System.currentTimeMillis() < openingUntil;
    }

    /** 是否正在“刚打开目标”的宽限期（供无障碍服务判断） */
    public static boolean isInOpeningGrace() {
        return insideOpeningWindow();
    }

    public static boolean initDhizuku(Context ctx) {
        try {
            return Dhizuku.init(ctx.getApplicationContext());
        } catch (Throwable t) {
            Log.w(TAG, "Dhizuku.init failed", t);
            return false;
        }
    }

    public static boolean dhizukuReady(Context ctx) {
        try {
            return Dhizuku.init(ctx.getApplicationContext()) && Dhizuku.isPermissionGranted();
        } catch (Throwable t) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // 挂起 / 解挂
    // ------------------------------------------------------------------
    public static boolean setSuspended(Context ctx, boolean suspended) {
        try {
            if (!dhizukuReady(ctx)) {
                Log.w(TAG, "Dhizuku not ready, skip suspend=" + suspended);
                return false;
            }
            DevicePolicyManager dpm = buildOwnerDpm(ctx);
            ComponentName owner = Dhizuku.getOwnerComponent();
            String[] failed = dpm.setPackagesSuspended(owner, new String[]{TARGET_PKG}, suspended);
            boolean ok = failed == null || failed.length == 0;
            Log.i(TAG, (suspended ? "suspend" : "unsuspend") + " ok=" + ok
                    + (failed != null && failed.length > 0 ? " failed=" + failed[0] : ""));
            return ok;
        } catch (Throwable t) {
            Log.w(TAG, (suspended ? "suspend" : "unsuspend") + " failed", t);
            return false;
        }
    }

    public static void suspend(Context ctx) {
        if (insideOpeningWindow()) return;
        setSuspended(ctx, true);
    }

    public static boolean unsuspend(Context ctx) {
        return setSuspended(ctx, false);
    }

    @SuppressLint({"PrivateApi", "DiscouragedPrivateApi"})
    private static DevicePolicyManager buildOwnerDpm(Context ctx) throws Exception {
        String ownerPkg = Dhizuku.getOwnerPackageName();
        Context ownerCtx = ctx.getApplicationContext().createPackageContext(
                ownerPkg, Context.CONTEXT_IGNORE_SECURITY);

        DevicePolicyManager dpm =
                (DevicePolicyManager) ownerCtx.getSystemService(Context.DEVICE_POLICY_SERVICE);

        // 把 device_policy binder 换成 Dhizuku 包装后的（以设备所有者身份转发）
        IBinder raw = getServiceBinder("device_policy");
        IBinder wrapped = Dhizuku.binderWrapper(raw);
        Class<?> stub = Class.forName("android.app.admin.IDevicePolicyManager$Stub");
        Method asIface = stub.getMethod("asInterface", IBinder.class);
        Object remote = asIface.invoke(null, wrapped);

        setField(dpm, "mService", remote);
        setField(dpm, "mContext", ownerCtx);
        return dpm;
    }

    @SuppressLint("PrivateApi")
    private static IBinder getServiceBinder(String name) throws Exception {
        Class<?> sm = Class.forName("android.os.ServiceManager");
        Method m = sm.getMethod("getService", String.class);
        return (IBinder) m.invoke(null, name);
    }

    private static void setField(Object obj, String name, Object value) throws Exception {
        Field f = DevicePolicyManager.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(obj, value);
    }

    /** 方便外部判断目标是否还可用（挂起时启动会失败） */
    public static boolean isSuspendSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N;
    }
}
