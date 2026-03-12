declare module "epubjs" {
  export interface LocationStart {
    cfi?: string;
    displayed?: {
      page?: number;
      total?: number;
    };
    href?: string;
  }

  export interface RelocatedLocation {
    start: LocationStart;
    end?: LocationStart;
    percentage?: number;
  }

  export interface RenditionOptions {
    width?: string | number;
    height?: string | number;
    spread?: "auto" | "none" | "both";
    flow?: "paginated" | "scrolled-doc" | "scrolled-continuous";
    manager?: string;
    allowScriptedContent?: boolean;
  }

  export interface NavigationItem {
    id: string;
    href: string;
    label: string;
  }

  export interface Navigation {
    toc: NavigationItem[];
  }

  export interface Locations {
    length(): number;
    generate(chars?: number): Promise<void>;
    percentageFromCfi(cfi: string): number;
    locationFromCfi(cfi: string): number;
  }

  export interface Book {
    ready: Promise<void>;
    locations: Locations;
    open(input: string | ArrayBuffer, what?: string): Promise<object>;
    renderTo(element: Element, options?: RenditionOptions): Rendition;
    destroy(): void;
  }

  export interface Rendition {
    display(target?: string): Promise<void>;
    prev(): Promise<void>;
    next(): Promise<void>;
    destroy(): void;
    on(event: "relocated", listener: (location: RelocatedLocation) => void): void;
    on(event: "keyup", listener: (event: KeyboardEvent) => void): void;
    off(event: "relocated", listener: (location: RelocatedLocation) => void): void;
    off(event: "keyup", listener: (event: KeyboardEvent) => void): void;
  }

  export default function ePub(input?: string | ArrayBuffer): Book;
}
