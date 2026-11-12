# Mi Centro Comercial 2.0

CRM comercial para **El Puntazo** (piñatería) y **Frutos del Nogal** (frutos secos):
clientes, cotizaciones, pedidos, despachos, ventas, cartera, cobros, comisiones,
agenda, WhatsApp, metas, reportes y copias de seguridad. PWA instalable en Android
y usable en computador. Funciona sin conexión.

> Proyecto independiente dentro de este repositorio: no usa Next.js ni Supabase y
> no tiene dependencias. Los datos viven **solo en el dispositivo** (IndexedDB).
> No hay sincronización en la nube.

## Uso local

```bash
cd mi-centro-comercial
npx http-server . -p 8080 -c-1     # o cualquier servidor estático
# abrir http://localhost:8080
```

Para instalarla en Android se necesita servirla por **HTTPS** (GitHub Pages,
Netlify, Cloudflare Pages o Vercel como sitio estático: publicar esta carpeta tal
cual, sin paso de compilación). En Chrome: menú ⋮ → *Instalar app*.

## Versión de un solo archivo

```bash
node mi-centro-comercial/tools/build-single-file.mjs salida.html
```

Genera un HTML autónomo (CSS y JS incluidos) que se abre con doble clic, sin servidor.

## Pruebas

```bash
node --test mi-centro-comercial/tests/*.test.mjs          # 46 pruebas del motor (CI)
# prueba de humo en navegador real (opcional, requiere Playwright):
npx http-server mi-centro-comercial -p 8085 -c-1 &
node mi-centro-comercial/tests/e2e.smoke.mjs http://localhost:8085
```

## Arquitectura

```
js/core/        dinero en pesos enteros (BigInt para proporciones), fechas, ids
js/domain/      FUENTE ÚNICA DE VERDAD — reglas de negocio puras y probadas
  schema.js       estructura v2, empresas, reglas de comisión por defecto
  documents.js    cotización → pedido → venta, despachos parciales, anulaciones
  ledger.js       cartera: saldos SIEMPRE calculados desde ventas + pagos activos
  payments.js     recaudos, asignación a varias cuentas, sin aplicar, reversos
  commissions.js  motor único de comisiones, umbral mensual, liquidaciones
  clients.js      CRM, KPIs, búsqueda, inactivos, línea de tiempo
  activities.js   llamadas, visitas, promesas de pago, tareas
  agenda.js · metrics.js · whatsapp.js · csv.js · backup.js · migrate.js
js/store/       IndexedDB con escritura comparar-y-guardar (rev), instantáneas,
                transacciones atómicas (todo o nada) y aviso entre pestañas
js/ui/          pantallas y formularios; nunca calculan saldos ni comisiones
```

Principios aplicados:

- Montos como **enteros en pesos**; porcentajes en puntos básicos (6 % = 600).
- Cada comando se ejecuta sobre una copia del estado y solo se guarda si valida.
- Idempotencia: cada formulario envía un `requestId`; un doble clic o reintento
  devuelve el mismo registro. Referencias de pago repetidas y pagos idénticos del
  mismo día piden confirmación explícita (no se rechazan en silencio).
- Nada financiero se borra: ventas se **anulan**, pagos se **reversan**, comisiones
  ya pagadas se corrigen con **ajustes negativos**; todo con motivo y fecha.
- Cada comisión guarda una copia de las reglas con que se calculó.
- Registro de auditoría de todas las operaciones.

Detalle de reglas: [docs/POLITICA-COMISIONES.md](docs/POLITICA-COMISIONES.md).
Auditoría inicial y plan por etapas: [docs/AUDITORIA.md](docs/AUDITORIA.md).

## Catálogo de Frutos del Nogal

`js/domain/catalog-nogal.js` trae la lista de precios entregada por el usuario
(66 productos: presentación mínima de venta, contenido en kg o unidades, precio
de la presentación antes de IVA, tarifa de IVA y notas para los datos que no
cuadran). Se carga con un botón en *Más → Productos* sin duplicar ni sobrescribir.
Todos los precios se pueden editar, y en cada documento el precio de la línea se
negocia libremente (antes de IVA o con IVA; el otro se calcula).

## Herramientas de venta (2.2)

- **PDF propio** (`js/core/pdf.js`, sin dependencias, Helvetica WinAnsi con tildes):
  cotización/pedido/venta con logo y datos de la empresa, e informe mensual de
  comisiones. Se comparte con la hoja nativa del teléfono o se descarga.
- **Precio por cliente** (`js/domain/pricing.js`): al cotizar se propone el último
  precio negociado con ese cliente; la ficha muestra la lista de precios acordados.
- **Umbral**: proyección por ritmo diario y simulador de comisión en cada documento,
  calculado con las mismas reglas del motor (`simulateSaleCommission`).
- **Repetir pedido** desde la ficha del cliente o el documento.
- **Registro rápido** con dictado por voz; `js/domain/nlp.js` detecta valor, fecha
  e intención de la nota (sin enviar nada a internet).
- **Análisis** (`js/domain/analytics.js`): productos más/menos vendidos por mes y
  clientes que dejaron de comprar un producto.

## Identidad visual (2.3)

"Nogal premium": verde bosque, dorado y marfil; modo oscuro de lujo automático.
Tipografías Fraunces (títulos y cifras) e Inter (texto), incluidas en `fonts/`
(licencia SIL OFL 1.1) para funcionar sin conexión. Íconos de línea propios
(`js/ui/icons.js`, estilo Lucide/ISC), monograma MC, pantalla de bienvenida,
tarjeta destacada con anillo de avance, transiciones, celebraciones al superar el
umbral o la meta, vibración al guardar, ventanas que se cierran deslizando y modo
discreto para ocultar montos. Respeta "reducir movimiento" del sistema.

## Datos y respaldo

- Primer arranque: si existen datos de la versión 1 (`localStorage['miCentroComercial_v1']`)
  se migran automáticamente. **La clave v1 no se borra** y además se guarda una
  instantánea literal. El informe de migración está en *Más → Datos*.
- Instantánea automática diaria, y antes de restaurar o borrar (10 más recientes).
- Copia completa descargable (JSON con suma de verificación) y restauración.
- Exportación CSV (Excel en español) de ventas, pagos, comisiones, cartera,
  clientes y productos; importación de clientes y productos sin sobrescribir.

`legacy/index-v1.html` es la versión 1 original, conservada como referencia.

## Versión 3.0

- **Alegría Pet Home** (botón "Alegría" en el selector de abajo): espacio propio, separado del CRM de El Puntazo y Frutos del Nogal.
  - Resumen del mes: ganancia (solo ventas con costo), margen, lo que te deben y lo que debes a proveedores.
  - Ventas con abonos, **cuenta de cobro** y **recibo de pago** en PDF (a nombre del titular del RUT, sin IVA mientras no se formalice).
  - Proveedores con términos comerciales y bitácora de conversaciones con seguimiento.
  - Compras a proveedores: actualizan el "costo puesto" (descuento y flete repartidos).
  - Productos y márgenes: 69 productos cargados desde la tienda Shopify, costos editables en la lista, simulador de descuento.
  - Importación del CSV de pedidos exportado de Shopify (sin duplicar).
- **Lector de RUT (PDF de la DIAN)** al crear clientes de El Puntazo y Nogal, también compartiendo el PDF desde WhatsApp. Usa pdf.js (Apache-2.0) en `vendor/pdfjs/`, dentro del celular.

## Versión 3.2 · Una mano

- Menú de secciones abajo, con el botón **+** al centro; el selector de empresa
  queda arriba. Se esconde al bajar por una lista y vuelve al subir.
- Contador de cobros vencidos sobre **Cartera** y saludo con el resumen del día.
- Gestos: deslizar un cliente (derecha WhatsApp, izquierda cobro), mantenerlo
  presionado para el menú rápido, jalar hacia abajo en Hoy para refrescar y
  deslizar entre secciones.
- Venta de Alegría: el producto se busca escribiendo su nombre.
- El buscador general también encuentra ventas, productos y proveedores de Alegría.
- Puntos de miles al escribir montos, vibraciones distintas por acción y
  pantallas vacías con botón directo. Atajo del ícono "Venta Alegría".
- Se quitó el ajuste para la insignia de Netlify (la app se publica en GitHub Pages).

## Versión 3.3 · Alegría se muda a su libro

- Alegría Pet Home sale de Mi Centro Comercial y pasa a su propia app, el **libro de
  socios** (carpeta `alegria-libro/`), que se comparte en la nube con el socio.
- Aquí queda solo **tu parte**: un cuadrito en Hoy con lo que te toca del mes, el mes
  anterior y lo que el negocio te debe, y la pantalla Más → Alegría Pet Home.
- Botón para **enviar una sola vez** al libro las ventas, compras, proveedores y costos
  que había en este celular, sin duplicar productos que ya estén allá.
- Tus clientes de El Puntazo y Frutos del Nogal nunca salen del celular.
