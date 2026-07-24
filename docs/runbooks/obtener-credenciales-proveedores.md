# Guía: cómo obtener las credenciales de cada proveedor (MX)

Guía operativa para conseguir **todas las APIs y datos** que necesitan las tres
integraciones de pago/envío: **Mercado Pago**, **Openpay** y **Skydropx**.
Complementa al runbook `mx-payments-shipping.md` (que explica cómo cargarlas y
verificarlas). Acá el foco es **de dónde sale cada valor**.

> **Modelo de credenciales.** Ningún secreto vive en el código. Se cargan
> **encriptados en la base de datos** desde **Admin > Provider Settings**
> (AES-256-GCM). Los únicos env vars que quedan activos son
> `PROVIDER_SETTINGS_ENCRYPTION_KEY` (la KEK) y `BACKEND_PUBLIC_URL`. Podés
> cargar los proveedores de dos formas:
>
> - **Manual (recomendado):** pegar cada valor en el panel de Admin.
> - **Seed único:** poblar los env vars `*_*` deprecados una sola vez y correr
>   `npx medusa exec ./src/scripts/seed-provider-settings.ts` (los importa a la
>   DB y después se pueden borrar del entorno).

---

## 0. Infra base (antes de tocar los proveedores)

Estos dos valores no dependen de ningún proveedor; los generás vos.

### 0.1 `PROVIDER_SETTINGS_ENCRYPTION_KEY` (KEK) — REQUERIDO

Clave que encripta todos los secretos de proveedor. Generala así:

```bash
openssl rand -base64 32
```

- Debe decodificar a **exactamente 32 bytes** (base64 o hex).
- **Guardala y respaldala por entorno.** Si la perdés o la cambiás, todos los
  secretos guardados quedan indescifrables y cada proveedor pasa a
  "unconfigured" (el backend igual bootea). La recuperación es setear una KEK
  nueva y **re-pegar cada credencial en el panel**.

### 0.2 `BACKEND_PUBLIC_URL` — REQUERIDO para webhooks

URL pública HTTPS del backend. En local/staging necesitás un **túnel** porque
los webhooks de pago son críticos (recuperan pagos diferidos: 3DS de Openpay y
OXXO de Mercado Pago).

```bash
# Opción A: cloudflared
cloudflared tunnel --url http://localhost:9000

# Opción B: ngrok
ngrok http 9000
```

Copiá la URL HTTPS que te da el túnel a `BACKEND_PUBLIC_URL`. En el storefront,
`NEXT_PUBLIC_BASE_URL` también debe ser HTTPS para que MP habilite `auto_return`
(gate S4.0c).

---

## 1. Mercado Pago (Checkout Pro — redirect)

**Panel:** https://www.mercadopago.com.mx/developers → *Tus integraciones*

Necesitás **3 datos**. Todo sale de crear (o abrir) una **Aplicación**.

### 1.1 Crear la aplicación

1. Entrá a **Tus integraciones** con tu cuenta MP.
2. **Crear aplicación** → nombre, y elegí el producto **Checkout Pro** (pagos
   online con redirect).

### 1.2 Obtener las credenciales

Dentro de la aplicación → sección **Credenciales**. Hay dos juegos:

- **Credenciales de prueba** (sandbox) → para desarrollo/verificación.
- **Credenciales de producción** → para cobros reales (requiere completar datos
  de la cuenta).

De ahí sacás:

| Dato del panel MP | Campo en Admin > Provider Settings | Secreto |
|---|---|---|
| **Access Token** (`APP_USR-...` o `TEST-...`) | `accessToken` | Sí (encriptado) |
| **Public Key** | `publicKey` | No (public_config) |

### 1.3 Obtener el Webhook Secret (firma x-signature)

1. En la misma aplicación → **Webhooks** (o *Notificaciones > Webhooks*).
2. Registrá la URL:
   `{BACKEND_PUBLIC_URL}/hooks/payment/pp_mercadopago_mercadopago`
   y suscribí el evento **Pagos (Payments)**.
3. Al **Guardar**, MP genera una **clave secreta / firma secreta** única para la
   app. Copiala.

| Dato del panel MP | Campo en Admin | Secreto |
|---|---|---|
| **Clave secreta / firma** del webhook | `webhookSecret` | Sí (encriptado) |

> El `sandbox` (modo) se deriva automáticamente. `BACKEND_PUBLIC_URL` se mapea
> en runtime desde el env — **no** se guarda en la DB.

**Resumen MP:** `accessToken` + `publicKey` + `webhookSecret`.

---

## 2. Openpay (tarjetas + 3DS — formulario self-hosted)

**Panel sandbox:** https://sandbox-dashboard.openpay.mx
**Panel producción:** https://dashboard.openpay.mx

> Openpay MX opera bajo dominios `.mx`. Para pruebas creá la cuenta en
> **Sandbox**; para real, pedí el pase a Producción.

### 2.1 Obtener ID de comercio y llaves de API

1. Entrá al Dashboard con tu cuenta.
2. Barra superior → ícono de **engranaje** → **Credenciales de API**.
3. Copiá tres valores:

| Dato del panel Openpay | Campo en Admin | Secreto |
|---|---|---|
| **ID** (identificador del comercio / Merchant ID) | `merchantId` | No (public_config) |
| **Llave privada** (private key, `sk_...`) | `privateKey` | Sí (encriptado) |
| **Llave pública** (public key, `pk_...`) | `publicKey` | No (public_config) |

> La **llave pública** solo tokeniza tarjetas en el front (openpay.js). La
> **llave privada** hace todas las operaciones de API — nunca la expongas.

### 2.2 Definir usuario/clave del webhook (Basic auth)

Openpay valida sus webhooks con **Basic auth**. Vos elegís el user y password
(no te los da el panel: los definís y los usás en ambos lados).

1. Elegí un `webhookUser` y un `webhookPassword` (ej. generá el password con
   `openssl rand -hex 24`).
2. Dashboard → **Webhooks** → registrá:
   `{BACKEND_PUBLIC_URL}/hooks/payment/pp_openpay_openpay`
   con esos **mismos** user/password de Basic auth.
3. Openpay manda un evento **`verification`** con un **código de verificación**;
   el dashboard te pide ingresarlo para activar el endpoint. El provider loguea
   ese código (acción `not_supported`) — leelo de los logs del backend o del
   detalle de entrega del dashboard.

| Dato | Campo en Admin | Secreto |
|---|---|---|
| Usuario del webhook (lo elegís vos) | `webhookUser` | Sí (encriptado) |
| Password del webhook (lo elegís vos) | `webhookPassword` | Sí (encriptado) |

> **PCI:** el form de tarjeta es self-hosted (tokenizado por openpay.js, la
> tarjeta nunca toca el backend). Esto pone al storefront en scope **SAQ A-EP**.
> Serví checkout sobre TLS y nunca loguees campos de tarjeta.

**Resumen Openpay:** `merchantId` + `publicKey` + `privateKey` +
`webhookUser` + `webhookPassword` + flag `sandbox`.

---

## 3. Skydropx (cotizaciones + compra de guías)

> ⚠️ **DECISIÓN OBLIGATORIA ANTES DE PEDIR LA CREDENCIAL (gate S5.0b).**
> Skydropx tiene **dos generaciones de API** con auth distinta:
>
> | Generación | Auth | Estado | Config actual del código |
> |---|---|---|---|
> | **Legacy v1** (`api.skydropx.com/v1`) | **API Key** simple (header `Authorization`) | **En deprecación** (Skydropx avisa fin de soporte; migrar a PRO) | ✅ Es a lo que apunta el código hoy (`SKYDROPX_DEFAULT_BASE_URL`) |
> | **Skydropx PRO** (`pro.skydropx.com`) | **OAuth** (Client ID + Client Secret → bearer token) | Versión vigente/recomendada | ❌ Requiere ajuste de código |
>
> **Recomendación:** confirmá con Skydropx (api@skydropx.com) qué versión
> soporta tu cuenta. Si te obligan a PRO, hay que ajustar el cliente para el
> flujo OAuth antes de cerrar el gate S5.0b. Si todavía tenés legacy, alcanza
> con la API Key.

### 3.1 Opción A — Legacy v1 (API Key, lo que el código espera hoy)

1. Escribí a **hola@skydropx.com / api@skydropx.com** desde el **email
   registrado en tu cuenta** Skydropx y pedí tu **API Key**.
2. Con esa key:

| Dato | Campo en Admin | Secreto |
|---|---|---|
| **API Key** | `apiKey` | Sí (encriptado) |
| Base URL (opcional; default `https://api.skydropx.com/v1`) | `baseUrl` | No |

### 3.2 Opción B — Skydropx PRO (OAuth)

1. Creá cuenta en **https://pro.skydropx.com**.
2. **Conexiones > API** → copiá **Client ID** y **Client Secret**.
3. Generá el **bearer token** con esas credenciales (según su doc de API).

> Si vas por PRO, avisame: hay que adaptar el cliente
> (`skydropx-fulfillment/client.ts` y `types.ts`) al flujo OAuth. Eso es parte
> del gate S5.0b y no está implementado todavía.

### 3.3 Datos que ponés vos (independientes de la versión)

| Dato | Campo en Admin | Secreto | Notas |
|---|---|---|---|
| **Código postal de origen** | `originZip` | No | CP del depósito/tienda desde donde despachás |
| **IVA incluido** | `taxInclusive` | No | Si `total_pricing` de Skydropx ya incluye IVA. Default: inclusive. Verificar en sandbox (gate S5.0b) |

> `originZip` también sale de la dirección del **stock location** en Admin
> (Settings → Locations & Shipping). El env `SKYDROPX_ORIGIN_ZIP` es fallback.

**Resumen Skydropx (legacy):** `apiKey` + `originZip` (+ `baseUrl` y
`taxInclusive` opcionales).

---

## 4. Precondición de producto (para que Skydropx cotice)

Skydropx solo cotiza si **cada variante** del carrito tiene `weight`, `length`,
`width`, `height` **positivos**.

- Convención: **peso en gramos, dimensiones en cm**.
- Variantes sin esos datos degradan el carrito a **envío manual (flat-rate)**.

Por eso, en Admin, mantené **siempre** una opción de envío manual en la zona
además de la de Skydropx: es el fallback de degradación elegante.

---

## 5. Checklist de recolección

Marcá a medida que conseguís cada dato:

**Infra**
- [ ] `PROVIDER_SETTINGS_ENCRYPTION_KEY` generada y respaldada
- [ ] `BACKEND_PUBLIC_URL` (túnel HTTPS activo si es local/staging)

**Mercado Pago**
- [ ] `accessToken` (test o prod)
- [ ] `publicKey`
- [ ] `webhookSecret` (tras registrar el webhook)

**Openpay**
- [ ] `merchantId` (ID de comercio)
- [ ] `privateKey`
- [ ] `publicKey`
- [ ] `webhookUser` + `webhookPassword` (definidos por vos)
- [ ] Endpoint de webhook registrado + código de `verification` ingresado

**Skydropx**
- [ ] Decidido: **legacy v1** o **PRO** (gate S5.0b)
- [ ] `apiKey` (legacy) **o** Client ID + Secret (PRO, requiere ajuste de código)
- [ ] `originZip`
- [ ] Confirmado si `taxInclusive` (verificar en sandbox)

**Carga**
- [ ] Cargadas en **Admin > Provider Settings** (o seed único corrido)
- [ ] Proveedores asignados a la región **Mexico** (§2.3 del runbook)

---

## 6. Enlaces oficiales

| Proveedor | Recurso |
|---|---|
| Mercado Pago | https://www.mercadopago.com.mx/developers/es/docs/your-integrations/credentials |
| Mercado Pago (webhooks) | https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks |
| Openpay (crear cuenta / credenciales) | https://documents.openpay.co/crear-cuenta/ |
| Openpay (API intro) | https://docs.openpay.co/en/docs/introduction.html |
| Skydropx (API Key legacy) | https://ayuda.skydropx.com/integraciones/apikey/ |
| Skydropx PRO (OAuth) | https://pro.skydropx.com/es-MX/api-docs |
