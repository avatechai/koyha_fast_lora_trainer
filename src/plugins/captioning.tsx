import { FolderPaths, debug } from "..";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { Plugin } from '../index'

export default function AutoCaptioningPlugin(): Plugin {
  return {
    getName() {
      return "Auto Captioning";
    },
    getFormUI() {
      return <>
        <div className="form-control">
          <label className="label cursor-pointer">
            <span className="label-text">Enable Auto Captioning</span>
            <input type="checkbox" name="enable-auto-captioning" className="toggle" checked />
          </label>
        </div>
      </>
    },
    onFilesUploaded({ folderPaths }) {
      return startCaptioning(folderPaths)
    },
  } satisfies Plugin
}


function startCaptioning(folderPaths: FolderPaths) {
  return new Promise<void>((resolve, reject) => {
    const modelUrl =
      "https://storage.googleapis.com/sfr-vision-language-research/BLIP/models/model_large_caption.pth";
    const dataDir = join(dirname(__dirname), folderPaths.img);
    const scripPath = "finetune/make_captions.py";

    const command = `source \"./../venv/bin/activate\" && cd ../ && CUDA_VISIBLE_DEVICES=1 python3 "${scripPath}" --batch_size="1" --num_beams="1" --top_p="0.9" --max_length="75" --min_length="5" --beam_search --caption_extension=".txt" --caption_weights ${modelUrl} "${dataDir}"`;

    console.log(command);

    if (debug) {
      resolve(null);
      return
    }

    const cmdarray = command.split(" ");
    const process = spawn(cmdarray.shift()!, cmdarray, {
      stdio: "inherit",
      shell: true,
    });
    process.on("close", resolve);
  });
}