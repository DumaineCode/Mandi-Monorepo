import { Metadata } from "next"

import { LEGAL_COMPANY as C } from "@modules/legal/company"
import { LegalPage, LegalSection } from "@modules/legal/components/legal-page"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description: `Términos y condiciones de uso y de venta de la tienda en línea de ${C.BRAND}.`,
}

const mail = (
  <a href={`mailto:${C.EMAIL}`} className="underline">
    {C.EMAIL}
  </a>
)

export default function TermsOfUsePage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Términos y condiciones"
      intro={
        <>
          <p>
            Los presentes Términos y condiciones (los &quot;Términos&quot;)
            regulan el uso del sitio web {C.WEBSITE} (el &quot;Sitio&quot;) y la
            compra de productos a través del mismo, ofrecidos por{" "}
            {C.LEGAL_IDENTITY} (&quot;{C.BRAND}&quot;), con domicilio en{" "}
            {C.ADDRESS}.
          </p>
          <p>
            Al acceder al Sitio, crear una cuenta o realizar un pedido, aceptas
            estos Términos, así como nuestro{" "}
            <LocalizedClientLink
              href="/content/privacy-policy"
              className="underline"
            >
              Aviso de privacidad
            </LocalizedClientLink>
            . Si no estás de acuerdo, te pedimos no utilizar el Sitio.
          </p>
        </>
      }
    >
      <LegalSection number={1} title="Uso del Sitio">
        <ul>
          <li>
            Para comprar debes ser mayor de edad y contar con capacidad legal
            para contratar.
          </li>
          <li>
            Te comprometes a proporcionar información verdadera, completa y
            actualizada, y a mantener la confidencialidad de tu cuenta y
            contraseña. Eres responsable de toda actividad realizada desde tu
            cuenta.
          </li>
          <li>
            Queda prohibido usar el Sitio con fines ilícitos, fraudulentos o que
            puedan dañar, sobrecargar o afectar su funcionamiento.
          </li>
          <li>
            {C.BRAND} podrá suspender o cancelar cuentas, restringir el acceso
            al Sitio o rechazar pedidos, a su discreción, cuando detecte un uso
            indebido o un incumplimiento de estos Términos.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={2} title="Productos, precios y disponibilidad">
        <ul>
          <li>
            Las fotografías, descripciones y recetas son ilustrativas. El
            empaque, color o presentación del producto pueden variar
            ligeramente sin que ello afecte su contenido o calidad.
          </li>
          <li>
            Los precios se expresan en pesos mexicanos (MXN) e incluyen IVA,
            salvo que se indique lo contrario. El costo de envío se muestra por
            separado antes de confirmar el pedido.
          </li>
          <li>
            {C.BRAND} puede modificar precios, promociones, productos y
            existencias en cualquier momento sin previo aviso. Los cambios no
            afectarán pedidos ya pagados y confirmados.
          </li>
          <li>
            Las promociones y códigos de descuento están sujetos a vigencia,
            existencias y a las condiciones particulares de cada uno; no son
            acumulables salvo que se indique expresamente.
          </li>
          <li>
            Todos los productos están sujetos a disponibilidad. Si un producto
            no está disponible después de tu compra, te lo notificaremos y te
            reembolsaremos el monto correspondiente.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={3} title="Pedidos">
        <ul>
          <li>
            El correo de confirmación que recibes al realizar un pedido acusa
            recibo de tu solicitud y no implica la aceptación definitiva del
            mismo, la cual queda sujeta a la validación del pago y a la
            disponibilidad del producto.
          </li>
          <li>
            {C.BRAND} se reserva el derecho de rechazar o cancelar cualquier
            pedido, incluso después de confirmado, en casos como: errores
            evidentes en precios o descripciones, falta de existencias,
            sospecha de fraude u operación no autorizada, datos incompletos o
            incorrectos, o imposibilidad de entrega en el domicilio indicado.
            En estos casos se reembolsará el importe pagado.
          </li>
          <li>
            Una vez realizado el pedido, solo podrás solicitar su cancelación
            antes de que haya sido enviado, escribiendo a {mail}. Pedidos ya
            enviados no podrán cancelarse.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={4} title="Pagos">
        <ul>
          <li>
            Los pagos serán procesados mediante la pasarela de Openpay y/o
            Mercado Pago, con los métodos que se muestren disponibles al
            momento de la compra.
          </li>
          <li>
            {C.BRAND} no almacena los datos completos de tu tarjeta. El
            procesamiento del pago está sujeto a los términos, validaciones y
            políticas de cada pasarela y de tu banco emisor, incluidas sus
            revisiones antifraude.
          </li>
          <li>
            {C.BRAND} no es responsable por rechazos, retenciones, cargos o
            demoras atribuibles a la pasarela de pago o a tu institución
            bancaria. Los meses sin intereses y demás promociones bancarias
            dependen exclusivamente de dichas instituciones.
          </li>
          <li>
            El pedido se procesará únicamente cuando el pago haya sido
            confirmado. Los pagos en efectivo o por referencia que no se
            completen dentro de su vigencia cancelarán el pedido de forma
            automática.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={5} title="Envíos">
        <ul>
          <li>
            Realizamos envíos dentro de la República Mexicana a través de
            empresas de paquetería y mensajería de terceros. La cobertura, el
            costo y las opciones de envío se calculan con base en tu código
            postal y se muestran antes de confirmar el pedido.
          </li>
          <li>
            Los tiempos de entrega son estimados y comienzan a contar a partir
            de la confirmación del pago. {C.BRAND} no garantiza fechas exactas
            de entrega y no es responsable por retrasos atribuibles a la
            paquetería, condiciones climáticas, zonas de difícil acceso, días
            festivos, contingencias o cualquier causa de fuerza mayor o caso
            fortuito.
          </li>
          <li>
            Es tu responsabilidad proporcionar un domicilio completo y correcto
            y que haya una persona disponible para recibir el pedido. Si la
            entrega no puede realizarse por datos incorrectos o ausencia del
            destinatario, los costos de reenvío o de retorno correrán por tu
            cuenta. Una vez enviado el pedido, no es posible cambiar el
            domicilio de entrega.
          </li>
          <li>
            Al recibir tu pedido, revisa el estado del paquete. Si presenta
            daños visibles, indícalo a la paquetería al momento de la entrega y
            repórtalo a {C.BRAND} según la sección 6.
          </li>
          <li>
            El pedido se considerará entregado cuando la paquetería registre su
            entrega en el domicilio indicado.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={6} title="Cambios y devoluciones">
        <p>
          Por tratarse de productos de consumo, y por razones de higiene,
          inocuidad y seguridad alimentaria,{" "}
          <strong>
            {C.BRAND} no acepta devoluciones ni cambios de productos
          </strong>
          , incluyendo casos de arrepentimiento, cambio de opinión, gusto o
          sabor, ni productos abiertos o manipulados.
        </p>
        <p>
          Únicamente se atenderán reportes cuando el producto llegue{" "}
          <strong>dañado, defectuoso o distinto al solicitado</strong>, siempre
          que se cumplan las siguientes condiciones:
        </p>
        <ul>
          <li>
            Se reporte a {mail} dentro de las 48 horas siguientes a la entrega.
          </li>
          <li>
            Se incluya el número de pedido, fotografías claras del producto,
            del empaque y de la guía de envío, y una descripción del problema.
          </li>
          <li>El producto no haya sido abierto, consumido ni manipulado.</li>
        </ul>
        <p>
          Una vez validado el reporte, {C.BRAND} realizará la reposición del
          producto o, si esto no fuera posible, el reembolso del importe
          correspondiente al mismo medio de pago. Los reportes presentados
          fuera de plazo o sin la evidencia solicitada podrán no ser
          procedentes.
        </p>
        <p>
          Los reembolsos que resulten procedentes se gestionan a través de la
          pasarela de pago utilizada; el tiempo en que se reflejen depende de
          la pasarela y de tu banco.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Facturación">
        <p>
          Si requieres factura, solicítala a {mail} dentro del mismo mes
          calendario en que realizaste tu compra, enviando tu número de pedido
          y tus datos fiscales completos. Después de ese plazo podríamos no
          estar en posibilidad de emitirla.
        </p>
      </LegalSection>

      <LegalSection number={8} title="Propiedad intelectual">
        <p>
          Las marcas, logotipos, nombres comerciales, textos, fotografías,
          recetas, diseños y demás contenido del Sitio son propiedad de{" "}
          {C.BRAND} o de sus respectivos titulares y están protegidos por la
          legislación aplicable. Queda prohibida su reproducción, distribución
          o uso sin autorización previa y por escrito.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Limitación de responsabilidad">
        <ul>
          <li>
            El Sitio se ofrece &quot;tal cual&quot; y según su disponibilidad.{" "}
            {C.BRAND} no garantiza que funcione de forma ininterrumpida o libre
            de errores, y podrá suspenderlo o modificarlo en cualquier momento.
          </li>
          <li>
            Revisa la etiqueta de cada producto antes de consumirlo,
            especialmente si tienes alergias, intolerancias o alguna condición
            de salud. {C.BRAND} no es responsable por el uso, preparación,
            conservación o consumo inadecuado de los productos.
          </li>
          <li>
            En la medida máxima permitida por la ley, la responsabilidad de{" "}
            {C.BRAND} derivada de cualquier compra se limita al monto pagado
            por el producto de que se trate.
          </li>
          <li>
            El Sitio puede contener enlaces a sitios de terceros (por ejemplo,
            redes sociales o pasarelas de pago), sobre los cuales {C.BRAND} no
            tiene control ni responsabilidad.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={10} title="Modificaciones">
        <p>
          {C.BRAND} podrá modificar estos Términos en cualquier momento. Las
          modificaciones entrarán en vigor desde su publicación en el Sitio y
          aplicarán a los pedidos realizados a partir de esa fecha. El uso
          continuado del Sitio implica la aceptación de los Términos vigentes.
        </p>
      </LegalSection>

      <LegalSection number={11} title="Legislación aplicable y jurisdicción">
        <p>
          Estos Términos se rigen por las leyes de los Estados Unidos
          Mexicanos. Para su interpretación y cumplimiento, las partes se
          someten a la jurisdicción de los tribunales competentes de la Ciudad
          de México, renunciando a cualquier otro fuero que pudiera
          corresponderles, sin perjuicio de los derechos que la legislación de
          protección al consumidor te otorga ante la Procuraduría Federal del
          Consumidor (PROFECO).
        </p>
      </LegalSection>

      <LegalSection number={12} title="Contacto">
        <p>
          Para cualquier duda sobre estos Términos, tus pedidos o reportes,
          escríbenos a {mail} o llámanos al {C.PHONE}.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
