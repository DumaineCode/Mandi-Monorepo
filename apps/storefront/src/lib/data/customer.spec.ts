import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  customerCreateAddress: vi.fn(),
  customerUpdateAddress: vi.fn(),
  customerDeleteAddress: vi.fn(),
  cartTransfer: vi.fn(),
  clientFetch: vi.fn(),
  getAuthHeaders: vi.fn(),
  getCacheOptions: vi.fn(),
  getCacheTag: vi.fn(),
  getCartId: vi.fn(),
  removeAuthToken: vi.fn(),
  removeCartId: vi.fn(),
  setAuthToken: vi.fn(),
  revalidateTag: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@lib/config", () => ({
  sdk: {
    auth: {
      register: mocks.authRegister,
      login: mocks.authLogin,
      logout: mocks.authLogout,
    },
    client: { fetch: mocks.clientFetch },
    store: {
      customer: {
        create: mocks.customerCreate,
        update: mocks.customerUpdate,
        createAddress: mocks.customerCreateAddress,
        updateAddress: mocks.customerUpdateAddress,
        deleteAddress: mocks.customerDeleteAddress,
      },
      cart: { transferCart: mocks.cartTransfer },
    },
  },
}))

vi.mock("@lib/util/medusa-error", () => ({
  default: (error: unknown) => {
    throw error
  },
}))

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

vi.mock("./cookies", () => ({
  getAuthHeaders: mocks.getAuthHeaders,
  getCacheOptions: mocks.getCacheOptions,
  getCacheTag: mocks.getCacheTag,
  getCartId: mocks.getCartId,
  removeAuthToken: mocks.removeAuthToken,
  removeCartId: mocks.removeCartId,
  setAuthToken: mocks.setAuthToken,
}))

import {
  addCustomerAddress,
  login,
  signup,
  updateCustomerAddress,
} from "./customer"

const registrationForm = () => {
  const formData = new FormData()
  formData.set("email", "cliente@example.com")
  formData.set("password", "safe-password")
  formData.set("first_name", "Ana")
  formData.set("last_name", "López")
  formData.set("phone", "5512345678")
  return formData
}

const addressForm = () => {
  const formData = new FormData()
  formData.set("first_name", "Ana")
  formData.set("last_name", "López")
  formData.set("address_1", "Av. Reforma 1")
  formData.set("city", "Ciudad de México")
  formData.set("postal_code", "06600")
  formData.set("province", "CDMX")
  formData.set("country_code", "mx")
  formData.set("phone", "5512345678")
  return formData
}

beforeEach(() => {
  vi.restoreAllMocks()
  Object.values(mocks).forEach((mock) => mock.mockReset())

  mocks.authRegister.mockResolvedValue("registration-token")
  mocks.authLogin.mockResolvedValue("login-token")
  mocks.customerCreate.mockResolvedValue({ customer: { id: "cus_01" } })
  mocks.cartTransfer.mockResolvedValue({ cart: { id: "cart_01" } })
  mocks.getAuthHeaders.mockResolvedValue({ authorization: "Bearer test" })
  mocks.getCacheOptions.mockResolvedValue({})
  mocks.getCacheTag.mockResolvedValue("customers-tag")
  mocks.getCartId.mockResolvedValue("cart_01")
  mocks.setAuthToken.mockResolvedValue(undefined)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("account authentication actions", () => {
  it("creates the customer, signs in, and transfers the cart", async () => {
    await expect(signup(null, registrationForm())).resolves.toBeNull()

    expect(mocks.customerCreate).toHaveBeenCalledTimes(1)
    expect(mocks.authLogin).toHaveBeenCalledTimes(1)
    expect(mocks.cartTransfer).toHaveBeenCalledWith(
      "cart_01",
      {},
      { authorization: "Bearer test" }
    )
  })

  it("reports that the account exists when automatic login fails", async () => {
    mocks.authLogin.mockRejectedValue(new Error("login unavailable"))

    await expect(signup(null, registrationForm())).resolves.toMatch(
      /^Tu cuenta se creó, pero/
    )
    expect(mocks.cartTransfer).not.toHaveBeenCalled()
  })

  it("does not misreport a cart-transfer failure as account creation failure", async () => {
    mocks.cartTransfer.mockRejectedValue(new Error("cart unavailable"))

    const result = await signup(null, registrationForm())

    expect(result).toMatch(/^Tu cuenta se creó e iniciaste sesión, pero/)
    expect(result).not.toMatch(/No pudimos crear tu cuenta/)
  })

  it("returns a Spanish authentication error without attempting cart transfer", async () => {
    mocks.authLogin.mockRejectedValue(new Error("invalid credentials"))

    await expect(login(null, registrationForm())).resolves.toBe(
      "No pudimos iniciar sesión. Verifica tu correo y contraseña."
    )
    expect(mocks.cartTransfer).not.toHaveBeenCalled()
  })

  it("surfaces a cart recovery warning after a successful login", async () => {
    mocks.cartTransfer.mockRejectedValue(new Error("cart unavailable"))

    await expect(login(null, registrationForm())).resolves.toMatch(
      /^Iniciaste sesión, pero no pudimos recuperar tu carrito/
    )
  })
})

describe("account address actions", () => {
  it("returns a Spanish error when creating an address fails", async () => {
    mocks.customerCreateAddress.mockRejectedValue(new Error("backend failure"))

    await expect(addCustomerAddress({}, addressForm())).resolves.toEqual({
      success: false,
      error:
        "No pudimos guardar la dirección. Revisa los datos e inténtalo de nuevo.",
    })
  })

  it("rejects an address update without an id before calling the SDK", async () => {
    await expect(updateCustomerAddress({}, addressForm())).resolves.toEqual({
      success: false,
      error: "No encontramos la dirección a actualizar.",
    })
    expect(mocks.customerUpdateAddress).not.toHaveBeenCalled()
  })
})
