# Auditoría de la versión 1 y plan por etapas

## Qué había (v1)

Un único `index.html` (89 KB, JavaScript sin dependencias) con datos en
`localStorage['miCentroComercial_v1']`: `clients`, `orders`, `suppliers`,
`products` y `settings` (tareas de agenda, metas, avisos). Tres negocios:
Frutos del Nogal, El Puntazo y Alegría Pet Home.

| Módulo | Estado en v1 |
|---|---|
| Clientes | Funcional básico (nombre, ciudad, actividad, teléfono, seguimiento). Borrado definitivo. Sin NIT, estados, condiciones ni historial. |
| Pedidos / cartera | Un "pedido" mezclaba pedido, venta y cuenta por cobrar. Sin productos, IVA ni descuentos. |
| Cobros | Abonos acumulados, pero el campo **"total cobrado" era editable a mano**, sin trazabilidad. Eliminar un pedido borraba sus cobros. Sin reversos ni control de duplicados. |
| Comisiones | Calculadas en pantalla a partir de campos editables. **Frutos del Nogal sin umbral de $70 M**, sobre el valor total (con IVA) y retroactivas. Sin estados (pendiente/pagada). |
| Despachos | Solo una fecha; sin despachos parciales. Las tareas de "despachar" aparecían también para pedidos pagados. |
| WhatsApp | Enlace directo; en pedidos no se agregaba +57. Sin plantillas. |
| Agenda / metas | Funcionales (metas sobre valor de pedidos, incluía Pet Home). |
| Respaldo | JSON sin verificación; restaurar o borrar todo sin copia previa. |
| PWA | `manifest.webmanifest` y `sw.js` referenciados pero **no existían**: no era instalable ni funcionaba sin conexión. |

## Riesgos de pérdida de datos detectados

1. Edición manual del total cobrado (comisiones y saldos podían cambiar sin rastro).
2. Borrado de pedidos con su historial de cobros.
3. Restaurar/borrar sin respaldo previo.
4. `localStorage` (~5 MB) sin aviso de espacio.

## Estrategia de respaldo aplicada

- La clave v1 **nunca se modifica ni se borra**; además se guarda una copia literal
  como instantánea interna y se puede descargar desde *Datos*.
- La migración no inventa información: los pedidos se convierten en ventas con su
  saldo, los abonos listados se conservan y la diferencia con el "total cobrado"
  de v1 se registra como un abono "sin detalle" (queda en el informe).
- No se generan comisiones retroactivas para lo migrado; el informe muestra la
  estimación que mostraba la v1 como referencia.
- Pet Home no está en el selector del CRM nuevo, pero sus datos se conservan en
  *Más → Alegría Pet Home (archivo)* y en todas las copias.

## Etapas

| # | Etapa | Estado |
|---|---|---|
| 1 | Integridad de datos: esquema v2, IndexedDB, transacciones, migración, instantáneas | ✅ |
| 2 | Empresas, clientes, ventas, cartera, cobros y comisiones (motor único + pruebas) | ✅ |
| 3 | Pedidos, productos por empresa, despachos parciales, condiciones de pago, cupos | ✅ |
| 4 | Agenda, gestiones de cobro, promesas, WhatsApp con plantillas | ✅ |
| 5 | Tablero, umbral, metas, reportes | ✅ |
| 6 | Importación/exportación CSV, copias y restauración | ✅ |
| 7 | PWA instalable y sin conexión | ✅ (falta publicar en un dominio HTTPS) |
| 8 | Pruebas: 37 del motor (CI) + prueba de humo en navegador | ✅ |

## Pendiente / siguientes pasos

- Publicar la carpeta en un hosting HTTPS para instalarla en el teléfono.
- Sincronización entre teléfono y computador (requiere backend y cuentas; hoy se
  pasa la información con copias de seguridad).
- Google Play: empaquetar como TWA (Bubblewrap) una vez publicada por HTTPS.
- Avisos en segundo plano (requieren servidor de notificaciones push).
- Devoluciones parciales de mercancía (hoy: anular y volver a registrar la venta).
