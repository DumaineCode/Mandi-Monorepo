import { Metadata } from "next"

import { LEGAL_COMPANY as C } from "@modules/legal/company"
import { LegalPage, LegalSection } from "@modules/legal/components/legal-page"

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  description: `Aviso de privacidad de ${C.BRAND}: cómo recabamos, usamos y protegemos tus datos personales.`,
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Aviso de privacidad"
      intro={
        <p>
          En cumplimiento de la Ley Federal de Protección de Datos Personales en
          Posesión de los Particulares, su Reglamento y demás disposiciones
          aplicables (en conjunto, la &quot;Ley&quot;), {C.LEGAL_IDENTITY} (en lo
          sucesivo, &quot;{C.BRAND}&quot;), pone a tu disposición el presente
          Aviso de privacidad, aplicable a los datos personales que recabamos a
          través de nuestro sitio web {C.WEBSITE}, nuestros canales de atención y
          cualquier otro medio relacionado con la venta de nuestros productos.
        </p>
      }
    >
      <LegalSection number={1} title="Responsable del tratamiento">
        <p>
          {C.LEGAL_NAME}, con domicilio en {C.ADDRESS}, es responsable del
          tratamiento de tus datos personales. Para cualquier asunto relacionado
          con este Aviso puedes escribirnos a{" "}
          <a href={`mailto:${C.EMAIL}`} className="underline">
            {C.EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection number={2} title="Datos personales que recabamos">
        <p>
          Para cumplir con las finalidades de este Aviso podemos recabar las
          siguientes categorías de datos personales:
        </p>
        <ul>
          <li>
            <strong>Identificación y contacto:</strong> nombre, correo
            electrónico, número telefónico.
          </li>
          <li>
            <strong>Entrega:</strong> domicilio de envío, código postal,
            colonia, referencias y datos de quien recibe.
          </li>
          <li>
            <strong>Facturación:</strong> razón social, RFC, régimen fiscal y
            domicilio fiscal, cuando solicites una factura.
          </li>
          <li>
            <strong>Cuenta:</strong> credenciales de acceso, historial de
            pedidos y direcciones guardadas.
          </li>
          <li>
            <strong>Navegación:</strong> dirección IP, tipo de navegador y
            dispositivo, páginas visitadas y datos recabados mediante cookies y
            tecnologías similares.
          </li>
        </ul>
        <p>
          {C.BRAND} no recaba datos personales sensibles. Tampoco almacena los
          datos completos de tu tarjeta bancaria (ver sección 4).
        </p>
      </LegalSection>

      <LegalSection number={3} title="Finalidades del tratamiento">
        <p>
          <strong>Finalidades primarias</strong>, necesarias para la relación
          comercial contigo:
        </p>
        <ul>
          <li>Procesar, confirmar, cobrar, enviar y dar seguimiento a tus pedidos.</li>
          <li>Crear y administrar tu cuenta.</li>
          <li>Emitir comprobantes fiscales cuando los solicites.</li>
          <li>Atender dudas, aclaraciones, quejas y reportes sobre pedidos.</li>
          <li>Prevenir fraudes y operaciones no autorizadas.</li>
          <li>Cumplir obligaciones legales y requerimientos de autoridades.</li>
        </ul>
        <p>
          <strong>Finalidades secundarias</strong>, que no son necesarias para
          la relación comercial pero nos permiten brindarte una mejor
          experiencia:
        </p>
        <ul>
          <li>Enviarte promociones, novedades, lanzamientos y publicidad.</li>
          <li>Realizar encuestas de satisfacción y estudios de mercado.</li>
          <li>Analizar el uso del sitio para mejorar nuestros productos y servicios.</li>
        </ul>
        <p>
          Si no deseas que tus datos se traten para las finalidades
          secundarias, envía un correo a{" "}
          <a href={`mailto:${C.EMAIL}`} className="underline">
            {C.EMAIL}
          </a>{" "}
          con el asunto &quot;Finalidades secundarias&quot;. Tu negativa no será
          motivo para negarte los productos que adquieras con nosotros.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Pagos">
        <p>
          Los pagos serán procesados mediante la pasarela de Openpay y/o Mercado
          Pago. Los datos de tu tarjeta o medio de pago se capturan y procesan
          directamente por dichos proveedores bajo sus propios estándares de
          seguridad (incluido PCI DSS) y sus respectivos avisos de privacidad.{" "}
          {C.BRAND} no almacena ni tiene acceso al número completo de tu tarjeta
          ni a su código de seguridad; únicamente recibe la confirmación del
          pago y datos limitados necesarios para identificar la operación.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Transferencias de datos">
        <p>
          Para cumplir con las finalidades primarias, podemos compartir tus
          datos personales, sin requerir tu consentimiento conforme a la Ley,
          con:
        </p>
        <ul>
          <li>Procesadores de pago (Openpay y/o Mercado Pago).</li>
          <li>
            Empresas de paquetería, mensajería y plataformas de gestión de
            envíos, para entregar tus pedidos.
          </li>
          <li>
            Proveedores de servicios tecnológicos (alojamiento, correo
            electrónico, facturación, analítica), que actúan por cuenta de{" "}
            {C.BRAND}.
          </li>
          <li>
            Autoridades competentes, cuando así lo requiera la ley o una orden
            de autoridad.
          </li>
        </ul>
        <p>{C.BRAND} no vende tus datos personales a terceros.</p>
      </LegalSection>

      <LegalSection number={6} title="Derechos ARCO y revocación del consentimiento">
        <p>
          Tienes derecho a acceder a tus datos personales, rectificarlos,
          cancelarlos u oponerte a su tratamiento (derechos ARCO), así como a
          revocar el consentimiento que nos hayas otorgado y a limitar el uso o
          divulgación de tus datos.
        </p>
        <p>
          Para ejercerlos envía tu solicitud a{" "}
          <a href={`mailto:${C.EMAIL}`} className="underline">
            {C.EMAIL}
          </a>{" "}
          indicando: (i) tu nombre y un medio para comunicarte contigo; (ii)
          copia de una identificación oficial o, en su caso, de la
          representación legal; (iii) la descripción clara de los datos y del
          derecho que deseas ejercer; y (iv) cualquier documento que facilite
          la localización de tus datos.
        </p>
        <p>
          Responderemos en los plazos que establece la Ley. La revocación del
          consentimiento no tendrá efectos retroactivos y, en ciertos casos, no
          será posible atenderla de inmediato cuando debamos seguir tratando
          tus datos por una obligación legal o para concluir un pedido en
          curso.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Cookies y tecnologías similares">
        <p>
          Nuestro sitio utiliza cookies y tecnologías similares para mantener
          tu sesión y carrito, recordar tus preferencias, medir el uso del sitio
          y mejorar tu experiencia. Puedes deshabilitarlas desde la
          configuración de tu navegador; sin embargo, algunas funciones del
          sitio (como el carrito o el proceso de compra) podrían dejar de
          funcionar correctamente.
        </p>
      </LegalSection>

      <LegalSection number={8} title="Seguridad y conservación">
        <p>
          {C.BRAND} aplica medidas de seguridad administrativas, técnicas y
          físicas razonables para proteger tus datos. Conservaremos tus datos
          únicamente durante el tiempo necesario para cumplir con las
          finalidades descritas y con las obligaciones legales, fiscales y
          contables aplicables.
        </p>
        <p>
          Ningún sistema es completamente infalible; en la medida permitida por
          la ley, {C.BRAND} no será responsable por accesos no autorizados
          derivados de causas ajenas a su control o de fallas en servicios de
          terceros.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Cambios al Aviso de privacidad">
        <p>
          {C.BRAND} se reserva el derecho de modificar o actualizar este Aviso
          en cualquier momento, por cambios legales, en nuestras prácticas o en
          los productos y servicios que ofrecemos. Cualquier cambio se publicará
          en esta misma página, indicando la fecha de la última actualización.
          Te recomendamos revisarla periódicamente.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Consentimiento">
        <p>
          Al navegar en nuestro sitio, crear una cuenta, realizar un pedido o
          proporcionarnos tus datos por cualquier medio, reconoces haber leído
          y entendido el presente Aviso de privacidad y consientes el
          tratamiento de tus datos personales en los términos aquí descritos.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
