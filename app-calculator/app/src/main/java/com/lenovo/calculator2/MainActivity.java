package com.lenovo.calculator2;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 伪装计算器：
 *   - 完全正常的基本计算器（+ - × ÷ % ± 退格 清空）
 *   - 暗码：依次输入 1955 后按 “=” 会启动被隐藏的 VMOS（com.vmos.pro）
 *     主入口 PureSplashActivity，随后本界面立即消失，不留任何痕迹。
 *   - 若 VMOS 未安装/入口被禁用，则“1955 =” 只是普通结果，不会出错。
 */
public class MainActivity extends Activity {

    // 暗码目标包 / 入口（对应修补后的“系统桌面”APK）
    private static final String VMOS_PKG = "com.vmos.pro";
    private static final String VMOS_ENTRY = "com.vmos.pro.activities.PureSplashActivity";
    private static final String SECRET = "1955";

    private TextView tvMain, tvExpr;

    // 计算器状态
    private Double acc = null;        // 累积值
    private String op = null;         // 待执行运算符
    private final StringBuilder cur = new StringBuilder("0"); // 当前输入
    private boolean fresh = true;     // 刚得到结果
    private boolean error = false;
    private String lastExpr = "";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
        tvMain = findViewById(R.id.tvMain);
        tvExpr = findViewById(R.id.tvExpression);
        buildKeypad();
        refresh();
    }

    // ---------------------------------------------------------------- UI
    private void buildKeypad() {
        GridLayout pad = findViewById(R.id.keypad);
        pad.setUseDefaultMargins(false);
        // 5 行 4 列
        final String[][] keys = {
                {"C", "\u232B", "%", "\u00F7"},   // C ⌫ % ÷
                {"7", "8", "9", "\u00D7"},        // ×
                {"4", "5", "6", "\u2212"},        // −
                {"1", "2", "3", "+"},
                {"\u00B1", "0", ".", "="},        // ±
        };
        for (int r = 0; r < 5; r++) {
            for (int c = 0; c < 4; c++) {
                final String t = keys[r][c];
                TextView btn = new TextView(this);
                btn.setText(t);
                btn.setTextSize(t.length() > 1 || t.equals("\u00B1") ? 22 : 26);
                btn.setGravity(Gravity.CENTER);
                btn.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
                btn.setIncludeFontPadding(false);

                if (t.equals("=")) {
                    btn.setTextColor(getColor(R.color.key_accent_text));
                    btn.setBackgroundResource(R.drawable.key_accent);
                } else if (isDigit(t) || t.equals(".")) {
                    btn.setTextColor(getColor(R.color.key_digit_text));
                    btn.setBackgroundResource(R.drawable.key_digit);
                } else {
                    btn.setTextColor(getColor(R.color.key_func_text));
                    btn.setBackgroundResource(R.drawable.key_func);
                }
                btn.setOnClickListener(v -> onKey(t));

                GridLayout.LayoutParams lp = new GridLayout.LayoutParams(
                        GridLayout.spec(r, 1, 1f), GridLayout.spec(c, 1, 1f));
                int m = dp(3);
                lp.setMargins(m, m, m, m);
                btn.setLayoutParams(lp);
                pad.addView(btn);
            }
        }
    }

    private boolean isDigit(String t) {
        if (t.length() != 1) return false;
        char ch = t.charAt(0);
        return ch >= '0' && ch <= '9';
    }

    private int dp(int v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

    // ------------------------------------------------------------ engine
    private double parse(String s) {
        try {
            return Double.parseDouble(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private void onKey(String k) {
        if (error) {
            if (k.equals("C") || isDigit(k) || k.equals(".")) clearAll();
            else return;
        }
        char c = k.charAt(0);
        if (isDigit(k)) {
            if (fresh) clearAll();
            if (cur.toString().equals("0")) cur.setLength(0);
            if (cur.length() < 16) cur.append(c);
        } else if (k.equals(".")) {
            if (fresh) clearAll();
            if (cur.indexOf(".") < 0) cur.append('.');
        } else if (k.equals("C")) {
            clearAll();
        } else if (k.equals("\u232B")) {              // backspace
            if (fresh) return;
            if (cur.length() > 1) cur.setLength(cur.length() - 1);
            else cur.setLength(0);
            if (cur.length() == 0) cur.append('0');
        } else if (k.equals("\u00B1")) {              // sign
            if (cur.length() == 0 || cur.toString().equals("0")) return;
            if (cur.charAt(0) == '-') cur.deleteCharAt(0);
            else cur.insert(0, '-');
        } else if (k.equals("%")) {
            double v = parse(cur.toString()) / 100.0;
            cur.setLength(0);
            cur.append(fmt(v));
        } else if (k.equals("+") || k.equals("\u2212") || k.equals("\u00D7") || k.equals("\u00F7")) {
            onOperator(k);
        } else if (k.equals("=")) {
            onEquals();
        }
        refresh();
    }

    private void onOperator(String opNew) {
        if (cur.length() == 0) { op = opNew; return; }
        double curV = parse(cur.toString());
        if (acc == null) {
            acc = curV;
        } else if (op != null) {
            acc = apply(acc, op, curV);
        } else {
            acc = curV;
        }
        op = opNew;
        cur.setLength(0);
        fresh = false;
        lastExpr = exprText(false);
    }

    private void onEquals() {
        // ---------------- 暗码 ----------------
        if (acc == null && op == null
                && cur.toString().equals(SECRET)) {
            tryLaunchVmos();
            return;
        }
        if (acc == null || op == null) { fresh = true; return; }
        double curV = parse(cur.toString());
        double res = apply(acc, op, curV);
        lastExpr = fmt(acc) + " " + op + " " + fmt(curV) + " =";
        acc = null;
        op = null;
        cur.setLength(0);
        cur.append(fmt(res));
        fresh = true;
    }

    private double apply(double a, String op, double b) {
        switch (op) {
            case "+":  return a + b;
            case "\u2212": return a - b;
            case "\u00D7": return a * b;
            case "\u00F7":
                if (b == 0) { error = true; return 0; }
                return a / b;
        }
        return b;
    }

    private String fmt(double v) {
        if (error) return getString(R.string.err_div0);
        if (Double.isNaN(v) || Double.isInfinite(v)) {
            error = true;
            return getString(R.string.err_div0);
        }
        String out;
        if (v == Math.floor(v) && Math.abs(v) < 1e15) {
            out = String.valueOf((long) v);
        } else {
            out = String.valueOf(v);
        }
        if (out.length() > 17) {
            out = String.format(java.util.Locale.US, "%.8e", v);
        }
        return out;
    }

    private void clearAll() {
        acc = null;
        op = null;
        cur.setLength(0);
        cur.append('0');
        fresh = true;
        error = false;
        lastExpr = "";
    }

    private String exprText(boolean withEq) {
        String c = cur.length() == 0 ? "" : cur.toString();
        return (acc == null ? "" : fmt(acc) + " " + (op == null ? "" : op + " ") + c);
    }

    private void refresh() {
        tvMain.setText(cur.length() == 0 ? (acc == null ? "0" : fmt(acc)) : cur.toString());
        if (tvMain.getText().length() > 0 && error) tvMain.setText(getString(R.string.err_div0));
        tvExpr.setText(lastExpr);
        if (!fresh && op != null) {
            String pre = acc == null ? "" : fmt(acc);
            tvExpr.setText((pre + " " + op).trim());
        }
    }

    // ------------------------------------------------------- 暗码启动
    private void tryLaunchVmos() {
        try {
            Intent i = new Intent();
            i.setComponent(new ComponentName(VMOS_PKG, VMOS_ENTRY));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            if (getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                startActivity(i);
                finish();       // 立即消失，任务栈不留痕
                return;
            }
        } catch (Throwable ignored) {
            // VMOS 不存在/被禁用时静默降级为普通计算器行为
        }
        // 降级：当成普通 “=” 显示 1955
        fresh = true;
    }
}
