export type SampleRecipe = {
  id: string
  name: string
  occasion: string
  product: string
  description: string
  servings: string
  prepMinutes: number
  waitMinutes: number
  waitLabel: string
  ingredients: string[]
  steps: string[]
  tip: string
}

// Editorial samples, not tested product formulas. Replace this collection with
// approved recipes before presenting it as an official Mandi recipe book.
export const sampleRecipes: SampleRecipe[] = [
  {
    id: "avena-nube-de-taro",
    name: "Avena nube de taro",
    occasion: "Desayuno",
    product: "Polvo Mandi sabor Taro",
    description:
      "Se prepara de noche y despierta contigo. Avena cremosa, plátano y un toque de taro para salir de la rutina.",
    servings: "2 frascos",
    prepMinutes: 10,
    waitMinutes: 480,
    waitLabel: "8 h de refrigeración",
    ingredients: [
      "80 g de hojuelas de avena",
      "240 ml de leche pasteurizada",
      "120 g de yogur natural",
      "20 g de polvo Mandi sabor Taro",
      "1 plátano mediano",
      "10 g de coco rallado",
    ],
    steps: [
      "Mezcla la leche con el polvo de taro hasta que no queden grumos. Incorpora el yogur y la avena.",
      "Reparte en dos frascos limpios con tapa. Refrigera durante 8 horas o toda la noche; no los dejes a temperatura ambiente.",
      "Al servir, mezcla de nuevo. Pela y corta el plátano en rodajas, repártelo entre los frascos y termina con el coco.",
    ],
    tip: "¿La prefieres más suelta? Agrega una cucharada extra de leche a cada frasco justo antes de servir.",
  },
  {
    id: "vasitos-recreo-de-galleta",
    name: "Vasitos recreo de galleta",
    occasion: "Snack",
    product: "Polvo Mandi sabor Cookies & Cream",
    description:
      "Capas de yogur, fresas y galleta. Un antojo de cuchara que no necesita horno ni una ocasión especial.",
    servings: "2 vasitos",
    prepMinutes: 15,
    waitMinutes: 0,
    waitLabel: "Sin espera",
    ingredients: [
      "250 g de yogur natural",
      "20 g de polvo Mandi sabor Cookies & Cream",
      "20 ml de leche pasteurizada",
      "150 g de fresas lavadas y desinfectadas",
      "4 galletas de chocolate (aprox. 40 g)",
    ],
    steps: [
      "Disuelve el polvo Cookies & Cream en la leche y mézclalo con el yogur hasta obtener una crema uniforme.",
      "Retira las hojas de las fresas y córtalas en cubitos. Trocea las galletas; deja algunos pedazos grandes para el crujido.",
      "Coloca la mitad de las galletas en dos vasos. Añade una capa de yogur y una de fresas. Repite con lo que queda.",
      "Sirve al momento para que las galletas sigan crujientes. Si los preparas antes, refrigera el yogur con la fruta y agrega las galletas al servir.",
    ],
    tip: "Usa vasos transparentes: aquí las capas también son parte del antojo.",
  },
  {
    id: "paletas-tarde-azul",
    name: "Paletas tarde azul",
    occasion: "Postre helado",
    product: "Mandi Ice Frutal sabor Blueberry",
    description:
      "Un remolino de yogur y blueberry para esas tardes en las que el congelador tiene la mejor idea.",
    servings: "6 paletas de 80 ml",
    prepMinutes: 15,
    waitMinutes: 360,
    waitLabel: "6 h de congelación",
    ingredients: [
      "30 g de Mandi Ice Frutal sabor Blueberry",
      "180 ml de agua potable",
      "250 g de yogur natural",
      "60 g de moras azules lavadas y desinfectadas",
    ],
    steps: [
      "Mezcla el Ice Frutal con el agua hasta disolverlo por completo. Incorpora 100 g del yogur.",
      "Reparte las moras entre seis moldes de paleta de 80 ml. Alterna cucharadas de la mezcla de blueberry y del yogur restante, dejando medio centímetro libre en cada molde.",
      "Pasa un palito una sola vez por cada molde para dibujar un remolino. Coloca los palitos y congela al menos 6 horas, hasta que estén completamente firmes.",
      "Para desmoldar, pasa el exterior del molde brevemente por agua tibia. Sirve de inmediato y conserva las paletas restantes congeladas.",
    ],
    tip: "No mezcles demasiado las capas: lo bonito está en que cada paleta tenga su propio remolino.",
  },
  {
    id: "gelatina-sol-de-mango",
    name: "Gelatina sol de mango",
    occasion: "Postre",
    product: "Tisana Mandi sabor Mango Maracuyá",
    description:
      "Tisana, mango y un poquito de paciencia. Un postre de vasito con sabor a sobremesa larga.",
    servings: "4 vasitos",
    prepMinutes: 25,
    waitMinutes: 240,
    waitLabel: "4 h de refrigeración",
    ingredients: [
      "15 g de tisana Mandi sabor Mango Maracuyá",
      "450 ml de agua potable para la infusión",
      "50 ml de agua fría para hidratar",
      "7 g de grenetina sin sabor",
      "20 g de azúcar",
      "150 g de pulpa de mango maduro en cubitos",
    ],
    steps: [
      "Espolvorea la grenetina sobre los 50 ml de agua fría y deja hidratar durante 5 minutos.",
      "Calienta los 450 ml de agua hasta hervir, retira del fuego y agrega la tisana. Tapa e infusiona 8 minutos. Cuela y mide 400 ml de infusión; si falta, completa con agua potable caliente.",
      "Mientras la infusión siga caliente, agrega el azúcar y la grenetina hidratada. Mezcla hasta disolverlas por completo, sin volver a hervir.",
      "Deja entibiar 10 minutos. Reparte el mango y la infusión en cuatro vasitos resistentes al calor. Refrigera al menos 4 horas o hasta que cuaje; sirve fría.",
    ],
    tip: "Reserva unos cubitos del mango de la receta para decorar al servir. Mantén los vasitos refrigerados.",
  },
]
