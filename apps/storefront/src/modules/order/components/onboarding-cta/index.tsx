"use client"

import { resetOnboardingState } from "@lib/data/onboarding"
import { Button, Container, Text } from "@modules/common/components/ui"

const OnboardingCta = ({ orderId }: { orderId: string }) => {
  return (
    <Container className="h-full w-full max-w-4xl border border-line bg-paper">
      <div className="center flex flex-col gap-y-4 p-4 md:items-center">
        <Text className="text-xl font-semibold text-ink">
          El pedido de prueba se creó correctamente.
        </Text>
        <Text className="text-sm text-ink-muted">
          Ya puedes terminar la configuración de la tienda en el panel de
          administración.
        </Text>
        <Button
          className="w-fit"
          size="large"
          onClick={() => resetOnboardingState(orderId)}
        >
          Terminar configuración
        </Button>
      </div>
    </Container>
  )
}

export default OnboardingCta
