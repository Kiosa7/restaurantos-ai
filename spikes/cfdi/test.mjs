// Valida el CONTRATO de los clientes PAC con fetch mockeado (sin credenciales
// reales — ver ⛔ en el mini-informe). Cuando haya cuenta sandbox real, este
// mismo archivo sirve de plantilla reemplazando fetchImpl por fetch real.
import { FacturamaClient, SwSapienClient, PacError } from "./client.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FALLÓ: " + msg);
  console.log("  ✔ " + msg);
}

function mockFetch(responses) {
  let call = 0;
  return async (url, opts) => {
    const r = responses[call++];
    return {
      ok: r.status < 400,
      status: r.status,
      json: async () => r.body,
    };
  };
}

async function main() {
  // --- Facturama: timbrado exitoso ---
  const fm = new FacturamaClient({
    apiKey: "test",
    fetchImpl: mockFetch([
      {
        status: 200,
        body: {
          Id: "abc123",
          Xml: "<cfdi/>",
          Complement: { TaxStamp: { Uuid: "1111-2222-3333", SatSeal: "QR..." } },
        },
      },
    ]),
  });
  const stamped = await fm.stamp({ Serie: "F", Folio: "1" });
  assert(stamped.uuid === "1111-2222-3333", "FacturamaClient extrae el UUID del timbre fiscal digital");

  // --- Facturama: error de timbrado propaga PacError ---
  const fmErr = new FacturamaClient({
    apiKey: "test",
    fetchImpl: mockFetch([{ status: 400, body: { Message: "RFC receptor inválido" } }]),
  });
  try {
    await fmErr.stamp({});
    throw new Error("debía lanzar");
  } catch (e) {
    assert(e instanceof PacError && e.message === "RFC receptor inválido", "FacturamaClient traduce errores 4xx a PacError con el mensaje del SAT");
  }

  // --- SW Sapien: timbrado exitoso, payload trae Sello/Certificado vacíos ---
  let capturedBody;
  const sw = new SwSapienClient({
    token: "test",
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ status: "success", data: { uuid: "4444-5555-6666", cfdi: "<cfdi/>", qrCode: "QR..." } }) };
    },
  });
  const stampedSw = await sw.stamp({ Emisor: { Rfc: "XAXX010101000" } });
  assert(stampedSw.uuid === "4444-5555-6666", "SwSapienClient extrae el UUID del folio fiscal");
  assert(capturedBody.data.Sello === "" && capturedBody.data.Certificado === "", "SwSapienClient envía Sello/Certificado vacíos (los llena el PAC con el CSD)");

  // --- SW Sapien: cancelación ---
  const swCancel = new SwSapienClient({
    token: "test",
    fetchImpl: mockFetch([{ status: 200, body: { status: "success" } }]),
  });
  const cancelResult = await swCancel.cancel("4444-5555-6666", "02");
  assert(cancelResult.status === "success", "SwSapienClient.cancel resuelve con status success");

  console.log("\nCONTRATO DE AMBOS CLIENTES VALIDADO CON MOCKS ✅ (llamada real sigue ⛔ bloqueada — falta cuenta sandbox)");
}

main().catch((e) => {
  console.error("SPIKE FALLÓ:", e);
  process.exit(1);
});
