import { describe, expect, it } from "vitest";
import { fillRich, fillText, textOf } from "@/lib/emails/texts";

describe("textos de los emails", () => {
  it("variables y tramos opcionales", () => {
    expect(fillText("Hola[ {nombre}], {invitador} te invita[ como {rol}].", { nombre: "Lucía", invitador: "Ana", rol: "" })).toBe("Hola Lucía, Ana te invita.");
    expect(fillText("Hola[ {nombre}],", { nombre: "" })).toBe("Hola,");
  });
  it("lo personalizado manda; vacío vuelve al texto por defecto", () => {
    expect(textOf("reset-password", "button", { button: "Cambiar" })).toBe("Cambiar");
    expect(textOf("reset-password", "button", { button: "  " })).toBe("Crear nueva contraseña");
  });
  it("el texto principal escapa todo y pone las variables en negrita", () => {
    const html = fillRich("Hola {nombre}<script>\n\nSegundo", { nombre: "<b>Ana</b>" }, (h) => `<p>${h}</p>`);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });
});
