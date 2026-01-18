<h1 align="center">
  <img src="../src-tauri/icons/icon.png" alt="Clash" width="128" />
  <br>
  Continuation of <a href="https://github.com/zzzgydi/clash-verge">Clash Verge</a>
  <br>
</h1>

<h3 align="center">
  یک رابط کاربری گرافیکی Clash Meta که با <a href="https://github.com/tauri-apps/tauri">Tauri</a> ساخته شده است.
</h3>

<p align="center">
  زبان‌ها:
  <a href="../README.md">简体中文</a> ·
  <a href="./README_en.md">English</a> ·
  <a href="./README_es.md">Español</a> ·
  <a href="./README_ru.md">Русский</a> ·
  <a href="./README_ja.md">日本語</a> ·
  <a href="./README_ko.md">한국어</a> ·
  <a href="./README_fa.md">فارسی</a>
</p>

## پیش‌نمایش

| تاریک                               | روشن                                  |
| ----------------------------------- | ------------------------------------- |
| ![Dark Preview](./preview_dark.png) | ![Light Preview](./preview_light.png) |

## نصب

برای دانلود فایل نصبی متناسب با پلتفرم خود، به [صفحه انتشار](https://github.com/clash-verge-rev/clash-verge-rev/releases) مراجعه کنید.<br> ما بسته‌هایی برای ویندوز (x64/x86)، لینوکس (x64/arm64) و macOS 10.15+ (اینتل/اپل) ارائه می‌دهیم.

#### انتخاب کانال انتشار

| Channel     | توضیحات                                                                                           | Link                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------- |
| Stable      | ساخت رسمی با قابلیت اطمینان بالا، ایده‌آل برای استفاده روزانه.                                    | [Release](https://github.com/clash-verge-rev/clash-verge-rev/releases)                 |
| Alpha (EOL) | نسخه‌های قدیمی (Legacy builds) برای اعتبارسنجی خط لوله انتشار (publish pipeline) استفاده می‌شوند. | [Alpha](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/alpha)         |
| AutoBuild   | نسخه‌های آزمایشی برای آزمایش و دریافت بازخورد. منتظر تغییرات آزمایشی باشید.                       | [AutoBuild](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/autobuild) |

#### راهنماهای نصب و سوالات متداول

برای مراحل نصب، عیب‌یابی و سوالات متداول، [مستندات پروژه](https://clash-verge-rev.github.io/) را مطالعه کنید.

---

### کانال تلگرام

برای اطلاع از آخرین اخبار به [@clash_verge_rev](https://t.me/clash_verge_re) بپیوندید.

## تبلیغات

#### [Doggygo VPN — شتاب‌دهنده جهانی عملکردگرا](https://verge.dginv.click/#/register?code=oaxsAGo6)

- سرویس شبکه برون مرزی با عملکرد بالا به همراه دوره‌های آزمایشی رایگان، طرح‌های تخفیف‌دار، امکان باز کردن قفل استریم و پشتیبانی درجه یک از پروتکل هیستریا.
- از طریق لینک اختصاصی Clash Verge ثبت نام کنید تا یک دوره آزمایشی ۳ روزه با ۱ گیگابایت ترافیک در روز دریافت کنید: [ثبت نام](https://verge.dginv.click/#/register?code=oaxsAGo6)
- کوپن تخفیف ۲۰٪ ویژه کاربران Clash Verge: `verge20` (محدود به ۵۰۰ بار استفاده)
- بسته تخفیف‌دار از ۱۵.۸ ین در ماه برای ۱۶۰ گیگابایت، به علاوه ۲۰٪ تخفیف اضافی برای صورتحساب سالانه
- توسط یک تیم خارجی با خدمات قابل اعتماد و تا 50٪ سهم درآمد اداره می‌شود
- کلاسترهای متعادل بار با مسیرهای اختصاصی پرسرعت (سازگار با کلاینت‌های قدیمی)، تأخیر فوق‌العاده کم، پخش روان 4K
- اولین ارائه‌دهنده جهانی که از پروتکل «Hysteria2» پشتیبانی می‌کند - کاملاً مناسب برای کلاینت Clash Verge
- پشتیبانی از سرویس‌های استریم و دسترسی به ChatGPT
- وبسایت رسمی: [https://狗狗加速.com](https://verge.dginv.click/#/register?code=oaxsAGo6)

## ویژگی‌ها

- ساخته شده بر اساس Rust با کارایی بالا و فریم‌ورک Tauri 2
- با هسته جاسازی‌شده [Clash.Meta (mihomo)](https://github.com/MetaCubeX/mihomo) ارائه می‌شود و از تغییر به کانال «آلفا» پشتیبانی می‌کند.
- رابط کاربری تمیز و مرتب با کنترل‌های رنگ تم، آیکون‌های گروه/سینی پروکسی و `تزریق CSS`
- مدیریت پروفایل پیشرفته (ادغام و کمک‌کننده‌های اسکریپت) با نکات مربوط به سینتکس پیکربندی
- کنترل‌های پروکسی سیستم، حالت محافظت و پشتیبانی از `TUN` (آداپتور شبکه مجازی)
- ویرایشگرهای بصری برای گره‌ها و قوانین
- پشتیبان‌گیری و همگام‌سازی مبتنی بر WebDAV برای تنظیمات

### سوالات متداول

برای راهنمایی‌های مربوط به هر پلتفرم، به [صفحه سوالات متداول](https://clash-verge-rev.github.io/faq/windows.html) مراجعه کنید.

### اهدا

[پشتیبانی از توسعه Clash Verge Rev](https://github.com/sponsors/clash-verge-rev)

## توسعه

برای دستورالعمل‌های دقیق مشارکت، به [CONTRIBUTING.md](../CONTRIBUTING.md) مراجعه کنید.

پس از نصب تمام پیش‌نیازهای **Tauri**، پوسته توسعه را با دستور زیر اجرا کنید:

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

## مشارکت‌ها

مشکلات و درخواست‌های pull مورد استقبال قرار می‌گیرند!

## تقدیر و تشکر

Clash Verge Rev بر اساس این پروژه‌ها ساخته شده یا از آنها الهام گرفته است:

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge): یک رابط کاربری گرافیکی Clash مبتنی بر Tauri برای ویندوز، macOS و لینوکس..
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri): ساخت برنامه‌های دسکتاپ کوچک‌تر، سریع‌تر و امن‌تر با رابط کاربری وب.
- [Dreamacro/clash](https://github.com/Dreamacro/clash): یک تونل مبتنی بر قانون که با زبان Go نوشته شده است.
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): یک تونل مبتنی بر قانون که با زبان Go نوشته شده است.
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg): رابط کاربری گرافیکی Clash برای ویندوز و macOS.
- [vitejs/vite](https://github.com/vitejs/vite): ابزارهای فرانت‌اند نسل بعدی با DX فوق‌العاده سریع.

## مجوز

مجوز GPL-3.0. برای جزئیات بیشتر به [فایل مجوز](../LICENSE) مراجعه کنید.
