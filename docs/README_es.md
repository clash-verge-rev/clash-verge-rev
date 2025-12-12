<h1 align="center">
  <img src="../src-tauri/icons/icon.png" alt="Clash" width="128" />
  <br>
  Continuación de <a href="https://github.com/zzzgydi/clash-verge">Clash Verge</a>
  <br>
</h1>

<h3 align="center">
Una interfaz gráfica para Clash Meta construida con <a href="https://github.com/tauri-apps/tauri">Tauri</a>.
</h3>

<p align="center">
  Idiomas:
  <a href="../README.md">简体中文</a> ·
  <a href="./README_en.md">English</a> ·
  <a href="./README_es.md">Español</a> ·
  <a href="./README_ru.md">Русский</a> ·
  <a href="./README_ja.md">日本語</a> ·
  <a href="./README_ko.md">한국어</a> ·
  <a href="./README_fa.md">فارسی</a>
</p>

## Vista previa

| Oscuro                              | Claro                               |
| ----------------------------------- | ----------------------------------- |
| ![Vista oscura](./preview_dark.png) | ![Vista clara](./preview_light.png) |

## Instalación

Visita la [página de lanzamientos](https://github.com/clash-verge-rev/clash-verge-rev/releases) y descarga el instalador que corresponda a tu plataforma.<br>
Ofrecemos paquetes para Windows (x64/x86), Linux (x64/arm64) y macOS 10.15+ (Intel/Apple).

#### Cómo elegir el canal de lanzamiento

| Canal       | Descripción                                                                    | Enlace                                                                                 |
| :---------- | :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| Stable      | Compilaciones oficiales de alta fiabilidad; ideales para el uso diario.        | [Release](https://github.com/clash-verge-rev/clash-verge-rev/releases)                 |
| Alpha (EOL) | Compilaciones heredadas usadas para validar el flujo de publicación.           | [Alpha](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/alpha)         |
| AutoBuild   | Compilaciones continuas para pruebas y retroalimentación. Espera cambios beta. | [AutoBuild](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/autobuild) |

#### Guías de instalación y preguntas frecuentes

Consulta la [documentación del proyecto](https://clash-verge-rev.github.io/) para encontrar los pasos de instalación, solución de problemas y preguntas frecuentes.

---

### Canal de Telegram

Únete a [@clash_verge_rev](https://t.me/clash_verge_re) para enterarte de las novedades.

## Promociones

#### [Doggygo VPN — Acelerador global orientado al rendimiento](https://verge.dginv.click/#/register?code=oaxsAGo6)

- Servicio internacional de alto rendimiento con prueba gratuita, planes con descuento, desbloqueo de streaming y soporte de protocolo Hysteria de primera clase.
- Regístrate mediante el enlace exclusivo de Clash Verge y obtén una prueba de 3 días con 1 GB de tráfico diario: [Regístrate](https://verge.dginv.click/#/register?code=oaxsAGo6)
- Cupón exclusivo de 20% de descuento para usuarios de Clash Verge: `verge20` (limitado a 500 usos)
- Plan promocional desde ¥15.8 al mes con 160 GB, más 20% de descuento adicional por pago anual
- Equipo ubicado en el extranjero para un servicio confiable, con hasta 50% de comisión compartida
- Clústeres balanceados con rutas dedicadas de alta velocidad (compatibles con clientes antiguos), latencia extremadamente baja, reproducción 4K sin interrupciones
- Primer proveedor global que soporta el protocolo `Hysteria2`, ideal para el cliente Clash Verge
- Desbloquea servicios de streaming y acceso a ChatGPT
- Sitio oficial: [https://狗狗加速.com](https://verge.dginv.click/#/register?code=oaxsAGo6)

#### Patrocinador de la infraestructura de compilación — [Servidores dedicados YXVM](https://yxvm.com/aff.php?aff=827)

Las compilaciones y lanzamientos del proyecto se ejecutan en servidores dedicados de YXVM, que proporcionan recursos premium, alto rendimiento y redes de alta velocidad. Si las descargas son rápidas y el uso es fluido, es gracias a este hardware robusto.

🧩 Ventajas de los servidores dedicados YXVM:

- 🌎 Rutas globales optimizadas para descargas significativamente más rápidas
- 🔧 Recursos bare-metal, en lugar de VPS compartidos, para obtener el máximo rendimiento
- 🧠 Ideales para proxys, alojamiento de sitios web/CDN, pipelines de CI/CD o cualquier carga elevada
- 💡 Listos para usar al instante, con múltiples centros de datos disponibles (incluidos CN2 e IEPL)
- 📦 La misma configuración utilizada por este proyecto está disponible para su compra
- 🎯 ¿Quieres el mismo entorno de compilación? [Solicita un servidor YXVM hoy](https://yxvm.com/aff.php?aff=827)

## Funciones

- Basado en Rust de alto rendimiento y en el framework Tauri 2
- Incluye el núcleo integrado [Clash.Meta (mihomo)](https://github.com/MetaCubeX/mihomo) y permite cambiar al canal `Alpha`
- Interfaz limpia y elegante con controles de color de tema, iconos de grupos proxy/bandeja y `CSS Injection`
- Gestión avanzada de perfiles (herramientas Merge y Script) con sugerencias de sintaxis para configuraciones
- Control del proxy del sistema, modo guardián y soporte para `TUN` (adaptador de red virtual)
- Editores visuales para nodos y reglas
- Copias de seguridad y sincronización mediante WebDAV

### Preguntas frecuentes

Visita la [página de FAQ](https://clash-verge-rev.github.io/faq/windows.html) para obtener instrucciones específicas por plataforma.

### Donaciones

[Apoya el desarrollo de Clash Verge Rev](https://github.com/sponsors/clash-verge-rev)

## Desarrollo

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para conocer las pautas de contribución.

Después de instalar todos los requisitos de **Tauri**, ejecuta el entorno de desarrollo con:

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

## Contribuciones

Se agradecen los issues y pull requests.

## Agradecimientos

Clash Verge Rev se basa en, o se inspira en, los siguientes proyectos:

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge): Interfaz gráfica para Clash basada en Tauri. Compatible con Windows, macOS y Linux.
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri): Construye aplicaciones de escritorio más pequeñas, rápidas y seguras con un frontend web.
- [Dreamacro/clash](https://github.com/Dreamacro/clash): Túnel basado en reglas escrito en Go.
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): Túnel basado en reglas escrito en Go.
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg): Interfaz de Clash para Windows y macOS.
- [vitejs/vite](https://github.com/vitejs/vite): Herramientas de frontend de nueva generación con una experiencia rapidísima.

## Licencia

Licencia GPL-3.0. Consulta el [archivo de licencia](../LICENSE) para más detalles.
