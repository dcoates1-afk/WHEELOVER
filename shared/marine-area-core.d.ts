export declare const MARINE_AREA_GROUPS: string[];

export declare function classifyMarineArea(
  tags: Record<string, string | undefined> | null | undefined,
): { group: string; label: string } | null;

export declare function elementPaths(element: {
  geometry?: { lat: number; lon: number }[];
  members?: { geometry?: { lat: number; lon: number }[] }[];
}): [number, number][][];

export declare function stitchPaths(
  paths: [number, number][][],
  tolerance?: number,
): [number, number][][];

export declare function isClosedPath(path: [number, number][]): boolean;

export declare function ringsAndLines(paths: [number, number][][]): {
  rings: [number, number][][];
  lines: [number, number][][];
};
