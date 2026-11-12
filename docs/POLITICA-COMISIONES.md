# Política de comisiones (implementada en `js/domain/commissions.js`)

Todas las comisiones se generan en un solo módulo, en el momento de la operación,
y quedan guardadas con: empresa, tipo (venta/cobro/ajuste), documento, cliente,
fecha de la operación, periodo, modalidad, base, tratamiento del IVA, porcentaje,
valor, estado, copia de las reglas y motivo de cualquier bloqueo o corrección.

Estados: **En espera** (Nogal: se paga si el mes llega a $70 M) · **Bloqueada** (no elegible, nunca se paga) · **Pendiente de
liquidar** · **Liquidada** (agrupada para cobrarla a la empresa) · **Pagada**
(solo cuando el usuario registra fecha y referencia del pago) · **Reversada**.

## El Puntazo

| Concepto | Regla |
|---|---|
| Venta | 0 %. No se crea ninguna línea de comisión por venta. |
| Cobro | 6 % del dinero efectivamente aplicado a una venta, sin importar la fecha de la venta. |
| Abonos | Proporcionales: $100.000 → $6.000; $50.000 → $3.000; el siguiente abono genera su propio 6 %. |
| Pago sin aplicar | No comisiona hasta asignarse a una venta. |
| Redondeo | Acumulado por venta: la suma de abonos coincide con el 6 % del total cobrado. |

## Frutos del Nogal

| Concepto | Regla |
|---|---|
| Umbral | $70.000.000 por mes calendario, sumando ventas vigentes por **fecha de venta**, base antes de IVA (configurable). |
| Todo o nada | Mientras el mes no llega a $70 M, la comisión de cada venta y cobro se acumula **en espera**. Al llegar, se desbloquea **toda** la comisión del mes desde el primer peso. Si el mes termina sin llegar, no se paga. |
| Después del umbral | Lo que se venda en el mismo mes comisiona de una vez. |
| Desbloqueo | Se registra **una vez**, con fecha y hora, al registrar la venta que lleva el acumulado al umbral. No se mueve después. |
| Comisión por cobro | Sigue al **mes de la venta**: si ese mes llegó a $70 M, el cobro comisiona aunque el pago llegue después. |
| Base | Antes de IVA y después de descuentos. En cobros: recaudo × (antes de IVA ÷ total), sin superar el saldo. |
| Tarifas | Mayorista 0,4 % venta / 0,4 % cobro · Normal 0,75 % / 0,75 %, según la modalidad guardada en la venta. Ej.: $1.000.000 antes de IVA → $4.000 / $7.500. |
| Nuevo mes | Nuevo periodo; el historial y las liquidaciones previas no cambian. |
| Anulaciones | Reversan la comisión de esa venta. Si el acumulado queda bajo el umbral, el desbloqueo registrado se mantiene y se muestra una advertencia. |
| Liquidar | Política confirmada por el usuario el 22-oct-2026. Si se cambian las reglas, hay que confirmarla de nuevo en *Comisiones*. |

### Decisiones confirmadas por el usuario

1. (13-oct-2026) El umbral de $70 M se mide sobre ventas **antes de IVA**, y la
   comisión (venta y cobro) siempre se calcula antes de IVA.
2. (22-oct-2026) **Todo o nada por mes**: "la comisión se va acumulando; si paso
   de los 70 millones desbloqueo la comisión de los 70 más las que haga en
   adelante; si no supero el tope no me pagan comisión". Reemplaza la regla
   anterior (solo el excedente, sin retroactividad). Los datos guardados se
   pasan a la regla nueva al abrir la app, sin tocar lo ya liquidado o pagado.

Ventas migradas de la versión 1 (sin desglose de IVA) suman al umbral de su mes
pero no comisionan.

## Correcciones

- Pago reversado o asignación liberada: si la comisión estaba pendiente pasa a
  *reversada*; si ya estaba liquidada o pagada, se crea un **ajuste negativo**
  pendiente de descontar en la siguiente liquidación.
- Cambio de porcentajes: solo afecta operaciones futuras (pruebas en `tests/`).
