import { Metadata } from "next"
import { FaWhatsapp } from "react-icons/fa"

export const metadata: Metadata = {
  title: "Desarrollos | Bebidas a la medida",
  description:
    "Desarrollamos bebidas a la medida de tu proyecto. Cuéntanos tus especificaciones y hablemos de la bebida que quieres crear.",
}

const projectDetails = [
  {
    title: "Sabor y experiencia",
    description: "El perfil de sabor, el dulzor y la textura que imaginas.",
  },
  {
    title: "Ingredientes",
    description:
      "Lo que quieres incluir y las restricciones que debemos conocer.",
  },
  {
    title: "Presentación y uso",
    description: "Cómo se servirá tu bebida y a quién va dirigida.",
  },
  {
    title: "Alcance del proyecto",
    description: "El volumen estimado, tus tiempos y otras especificaciones.",
  },
]

const whatsappHref = `https://wa.me/5215529130187?text=${encodeURIComponent(
  "Hola, me interesa desarrollar una bebida a la medida. Quisiera compartirles mi idea y las especificaciones de mi proyecto."
)}`

export default function DevelopmentsPage() {
  return (
    <div className="bg-paper font-hanken text-ink">
      <section className="bg-teal" aria-labelledby="developments-title">
        <div className="content-container grid gap-12 py-14 small:grid-cols-[1.2fr_1fr] small:items-center small:gap-16 small:py-24">
          <div>
            <p className="mb-6 font-mono text-xs uppercase tracking-widest">
              Desarrollos · Bebidas a la medida
            </p>
            <h1
              id="developments-title"
              className="font-blusans text-5xl leading-[1.05] small:text-7xl"
            >
              Tu idea.
              <br />
              Tu bebida.
              <br />
              <span className="text-ink-soft">A tu medida.</span>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed">
              Cada proyecto tiene su propio sabor. Desarrollamos bebidas con las
              especificaciones que necesitas para darle forma al tuyo.
            </p>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex min-h-12 items-center gap-3 rounded-full bg-ink px-6 py-3 font-blusans text-cream transition-colors hover:bg-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              <FaWhatsapp className="h-5 w-5 shrink-0" aria-hidden="true" />
              Cuéntanos tu proyecto
              <span className="sr-only">
                {" "}
                por WhatsApp (abre una nueva pestaña)
              </span>
            </a>
          </div>

          <aside
            className="rounded-2xl border border-ink/20 bg-paper p-6 small:rotate-2 small:p-9"
            aria-labelledby="project-details-title"
          >
            <div className="mb-7 flex items-center justify-between gap-4 border-b border-ink/20 pb-5">
              <p className="font-mono text-xs uppercase tracking-widest">
                El punto de partida
              </p>
              <span className="rounded-full bg-teal px-3 py-1 text-xs font-semibold">
                Tu proyecto
              </span>
            </div>
            <h2 id="project-details-title" className="font-blusans text-3xl">
              ¿Qué tienes en mente?
            </h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              Estas son algunas de las cosas que nos gustaría conocer.
            </p>
            <dl className="mt-7 space-y-5">
              {projectDetails.map(({ title, description }) => (
                <div key={title} className="border-t border-line pt-4">
                  <dt className="font-blusans text-lg">{title}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-muted">
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      <section
        className="content-container py-12 small:py-16"
        aria-labelledby="start-title"
      >
        <div className="grid gap-6 border-l-4 border-teal pl-6 small:grid-cols-2 small:gap-16 small:pl-8">
          <h2
            id="start-title"
            className="max-w-md font-blusans text-3xl small:text-4xl"
          >
            No necesitas tenerlo todo definido para empezar.
          </h2>
          <p className="max-w-xl self-center text-lg leading-relaxed text-ink-muted">
            Comparte tu idea y las especificaciones que ya tengas. Con esa
            información, podemos conversar sobre lo que buscas y los siguientes
            pasos para tu desarrollo.
          </p>
        </div>
      </section>
    </div>
  )
}
