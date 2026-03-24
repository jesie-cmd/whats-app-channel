declare module "qrcode-terminal" {
  export function generate(
    text: string,
    options?: { small?: boolean },
    callback?: (output: string) => void,
  ): void;
}

declare module "qrcode" {
  export function toString(
    text: string,
    options?: {
      type?: "svg" | "utf8" | "terminal";
      width?: number;
      margin?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
  export function toDataURL(
    text: string,
    options?: {
      width?: number;
      margin?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
}
