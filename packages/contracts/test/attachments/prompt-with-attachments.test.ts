import { describe, expect, it } from "vitest";
import { promptWithAttachments, type PromptAttachment } from "../../src/attachments/attachment.ts";

const anhang = (teil: Partial<PromptAttachment>): PromptAttachment => ({
  id: "a1",
  name: "bild.png",
  mimeType: "image/png",
  kind: "image",
  bytes: 22_000,
  path: "/data/attachments/bild.png",
  text: "",
  method: null,
  ...teil,
});

describe("promptWithAttachments — was der Agent über einen Anhang weiß", () => {
  it("nenennt Pfad, Art und Größe", () => {
    const prompt = promptWithAttachments("Schau dir das an", [anhang({})]);
    expect(prompt).toContain("Datei: /data/attachments/bild.png");
    expect(prompt).toContain("image/png");
    expect(prompt).toContain("21 KB");
  });

  it("schickt ein Bild ohne OCR-Text als Bild weiter, das der Agent selbst ansehen kann", () => {
    const prompt = promptWithAttachments("", [anhang({})]);
    // „kein Text auslesbar" allein ist eine Sackgasse: der Agent lässt das Bild
    // dann links liegen, obwohl er es als Datei oeffnen koennte (Nutzerfund 23.11.2026).
    expect(prompt).toMatch(/Bild/);
    expect(prompt).toMatch(/ansehen/);
    expect(prompt).toContain("/data/attachments/bild.png");
  });

  it("haelt sich bei Nicht-Bildern ohne Text kurz", () => {
    const prompt = promptWithAttachments("", [anhang({ name: "daten.bin", mimeType: "application/octet-stream", kind: "other" })]);
    expect(prompt).toContain("(kein Text auslesbar)");
    expect(prompt).not.toMatch(/ansehen/);
  });

  it("gibt ausgelesenen Text mit Methode an", () => {
    const prompt = promptWithAttachments("", [anhang({ text: "Bestellung 4711", method: "tesseract" })]);
    expect(prompt).toContain("Inhalt (tesseract):");
    expect(prompt).toContain("Bestellung 4711");
  });

  it("markiert nativ uebergegebene Anhaenge als Datei, nicht als Text", () => {
    const prompt = promptWithAttachments("", [anhang({ id: "nativ1" })], new Set(["nativ1"]));
    expect(prompt).toContain("(als Datei übergeben)");
  });
});
