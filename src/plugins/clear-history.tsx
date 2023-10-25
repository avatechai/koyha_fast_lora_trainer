import { FolderPaths, debug } from "..";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { Plugin } from "../index";
import { PiBroom } from "react-icons/pi"

export default function ClearHistoryPlugin(): Plugin {
  return {
    getName() {
      return "Clear History";
    },
    getExtraUI() {
      return (
        <>
          <div>
            <button className="btn btn-ghost btn-sm" hx-target="#run-container" hx-swap="outerHTML" hx-get="/container" hx-confirm="Are you sure you want to clear history?"
            >
              <PiBroom size={20}/>
            </button>
          </div>
        </>
      );
    },
  } satisfies Plugin;
}
