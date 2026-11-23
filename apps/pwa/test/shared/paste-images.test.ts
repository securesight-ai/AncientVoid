import { describe, expect, it } from "vitest";
import { imageFilesFrom } from "../../src/shared/paste-images.ts";

const datei = (name: string, typ: string, größe = 8): File => new File([new Uint8Array(größe)], name, { type: typ });

/** Ein Datenträger, so wie Browser ihn beim Einfügen reichen — mal mit `files`, mal nur mit `items`. */
function transfer(init: { files?: File[]; items?: Array<{ kind: string; file: File | null }> }): DataTransfer {
  const items = (init.items ?? []).map((e) => ({ kind: e.kind, getAsFile: () => e.file }));
  return { files: init.files ?? [], items } as unknown as DataTransfer;
}

describe("Bild-Einfügen im Composer", () => {
  it("nimmt ein Bild aus `files`", () => {
    const b = datei("screenshot.png", "image/png");
    expect(imageFilesFrom(transfer({ files: [b] })).map((f) => f.name)).toEqual(["screenshot.png"]);
  });

  it("nimmt ein Bild aus `items`, wenn `files` leer bleibt (viele Handy-Tastaturen)", () => {
    const b = datei("bild.jpg", "image/jpeg");
    expect(imageFilesFrom(transfer({ items: [{ kind: "file", file: b }] })).map((f) => f.name)).toEqual(["bild.jpg"]);
  });

  it("nimmt denselben Screenshot nur einmal, wenn beides gefüllt ist", () => {
    const imFiles = datei("s1.png", "image/png");
    const imItems = datei("s1.png", "image/png");
    expect(imageFilesFrom(transfer({ files: [imFiles], items: [{ kind: "file", file: imItems }] })).length).toBe(1);
  });

  it("lässt reinen Text durch — der gehört weiterhin ins Eingabefeld", () => {
    expect(imageFilesFrom(transfer({ items: [{ kind: "string", file: null }] }))).toEqual([]);
    expect(imageFilesFrom(transfer({}))).toEqual([]);
  });

  it("lässt andere Dateitypen als Nicht-Bild durch (PDF, Text)", () => {
    expect(imageFilesFrom(transfer({ files: [datei("rechnung.pdf", "application/pdf"), datei("notiz.txt", "text/plain")] }))).toEqual([]);
  });

  it("hält mehrere Bilder in der Reihenfolge des Einfügens", () => {
    const t = transfer({ files: [datei("a.png", "image/png"), datei("b.webp", "image/webp")] });
    expect(imageFilesFrom(t).map((f) => f.name)).toEqual(["a.png", "b.webp"]);
  });

  it("verträgt fehlende Datenträger (Testlauf ohne DOM)", () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
  });
});
