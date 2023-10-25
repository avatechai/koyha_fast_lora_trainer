import { FolderPaths, debug } from "..";
import path, { dirname, join } from "path";
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
            <span className="label-text">Enable Auto Captioning (BLIP)</span>
            <input type="checkbox" name="enable-auto-captioning-blip" className="toggle" />
          </label>
        </div>
      </>
    },
    onFilesUploaded({ folderPaths, formdata }) {
      if (formdata.get('enable-auto-captioning-blip') !== 'on') return
      
      return startCaptioning(folderPaths, formdata)
    },
  } satisfies Plugin
}


function startCaptioning(folderPaths: FolderPaths, formdata: FormData) {
  return new Promise<void>((resolve, reject) => {
    const modelUrl =
      "https://storage.googleapis.com/sfr-vision-language-research/BLIP/models/model_large_caption.pth";
    const dataDir = join(path.resolve(import.meta.dir, '..', '..'), folderPaths.img);
    const scripPath = "finetune/make_captions.py";
    const device = formdata.get('CUDA_VISIBLE_DEVICES') || '0';

    const command = `source \"./../venv/bin/activate\" && cd ../ && CUDA_VISIBLE_DEVICES=${device} python3 "${scripPath}" --batch_size="1" --num_beams="1" --top_p="0.9" --max_length="75" --min_length="5" --beam_search --caption_extension=".txt" --caption_weights ${modelUrl} "${dataDir}"`;

    console.log(command);

    if (debug) {
      resolve();
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
