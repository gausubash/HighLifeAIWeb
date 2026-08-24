import type { OverlayEntity } from "./types";

export type OverlayCommand =
  | { type: "add"; entity: OverlayEntity }
  | { type: "update"; id: string; before: OverlayEntity; after: OverlayEntity }
  | { type: "remove"; entities: OverlayEntity[] };

export function applyCommand(entities: OverlayEntity[], command: OverlayCommand): OverlayEntity[] {
  switch (command.type) {
    case "add":
      return [...entities, command.entity];
    case "update":
      return entities.map((e) => (e.id === command.id ? command.after : e));
    case "remove": {
      const ids = new Set(command.entities.map((e) => e.id));
      return entities.filter((e) => !ids.has(e.id));
    }
    default:
      return entities;
  }
}

export function invertCommand(command: OverlayCommand): OverlayCommand {
  switch (command.type) {
    case "add":
      return { type: "remove", entities: [command.entity] };
    case "remove":
      return command.entities.length === 1
        ? { type: "add", entity: command.entities[0] }
        : { type: "remove", entities: [] }; // restored via applyInverseBatch
    case "update":
      return { type: "update", id: command.id, before: command.after, after: command.before };
    default:
      return command;
  }
}

/** Undo a command against the current entity list. */
export function undoCommand(entities: OverlayEntity[], command: OverlayCommand): OverlayEntity[] {
  switch (command.type) {
    case "add":
      return entities.filter((e) => e.id !== command.entity.id);
    case "update":
      return entities.map((e) => (e.id === command.id ? command.before : e));
    case "remove": {
      const next = [...entities];
      for (const ent of command.entities) {
        if (!next.some((e) => e.id === ent.id)) next.push(ent);
      }
      return next;
    }
    default:
      return entities;
  }
}
