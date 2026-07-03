// Clientes PAC (Facturama y SW Sapien) para CFDI 4.0. Estructurados contra la
// documentación pública de cada proveedor (ver mini-informe de este spike);
// NO se han probado contra las APIs reales porque no hay cuenta/credenciales
// (⛔ bloqueado — ver docs/spikes/spike-3-cfdi.md). Los tests de este spike
// usan `fetch` mockeado para validar el CONTRATO del cliente (armado del
// payload, manejo de errores, parseo de UUID) de forma que el día que haya
// credenciales, solo hace falta inyectar el token real.

/** @typedef {{ uuid: string, xml: string, qr?: string }} StampResult */

export class PacError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "PacError";
    this.code = code;
    this.cause = cause;
  }
}

/** Interfaz común que el resto del sistema consume (Fase 7). */
export class PacClient {
  /** @returns {Promise<StampResult>} */
  async stamp(_cfdiJson) {
    throw new Error("no implementado");
  }
  async cancel(_uuid, _motivo) {
    throw new Error("no implementado");
  }
}

export class FacturamaClient extends PacClient {
  constructor({ apiKey, sandbox = true, fetchImpl = fetch } = {}) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = sandbox ? "https://apisandbox.facturama.mx" : "https://api.facturama.mx";
    this._fetch = fetchImpl;
  }
  async stamp(cfdiJson) {
    const res = await this._fetch(`${this.baseUrl}/3/cfdis`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${this.apiKey}`,
      },
      body: JSON.stringify(cfdiJson),
    });
    const body = await res.json();
    if (!res.ok) throw new PacError(body.Message ?? "error al timbrar", res.status, body);
    return { uuid: body.Complement?.TaxStamp?.Uuid ?? body.Id, xml: body.Xml ?? "", qr: body.Complement?.TaxStamp?.SatSeal };
  }
  async cancel(uuid, motivo = "02") {
    const res = await this._fetch(`${this.baseUrl}/3/cfdis/${uuid}?motive=${motivo}`, {
      method: "DELETE",
      headers: { authorization: `Basic ${this.apiKey}` },
    });
    const body = await res.json();
    if (!res.ok) throw new PacError(body.Message ?? "error al cancelar", res.status, body);
    return body;
  }
}

export class SwSapienClient extends PacClient {
  constructor({ token, sandbox = true, fetchImpl = fetch } = {}) {
    super();
    this.token = token;
    this.baseUrl = sandbox ? "https://services.test.sw.com.mx" : "https://services.sw.com.mx";
    this._fetch = fetchImpl;
  }
  async stamp(cfdiJson) {
    const res = await this._fetch(`${this.baseUrl}/v3/cfdi33/issue/json/v4`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/jsontoxml",
      },
      body: JSON.stringify({ data: { ...cfdiJson, Sello: "", Certificado: "", NoCertificado: "" } }),
    });
    const body = await res.json();
    if (!res.ok || body.status === "error") {
      throw new PacError(body.message ?? body.messageDetail ?? "error al timbrar", body.code ?? res.status, body);
    }
    return { uuid: body.data?.uuid, xml: body.data?.cfdi ?? "", qr: body.data?.qrCode };
  }
  async cancel(uuid, motivo = "02") {
    const res = await this._fetch(`${this.baseUrl}/v3/cfdi33/cancel/csd`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ uuid, motivo }),
    });
    const body = await res.json();
    if (!res.ok || body.status === "error") throw new PacError(body.message ?? "error al cancelar", body.code ?? res.status, body);
    return body;
  }
}
