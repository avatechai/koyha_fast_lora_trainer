import { FolderPaths, debug } from "..";
import path,{ dirname, join } from "path";
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
            <span className="label-text">Enable Auto Captioning (WD14)</span>
            <input type="checkbox" name="enable-auto-captioning-wd14" className="toggle" defaultChecked />
          </label>
        </div>
      </>
    },
    onFilesUploaded({ folderPaths, formdata }) {
      if (formdata.get('enable-auto-captioning-wd14') !== 'on') return
      
      return startCaptioning(folderPaths)
    },
  } satisfies Plugin
}


function startCaptioning(folderPaths: FolderPaths) {
  return new Promise<void>((resolve, reject) => {
    const dataDir = join(path.resolve(import.meta.dir, '..', '..'), folderPaths.img);
    const scripPath = "finetune/tag_images_by_wd14_tagger.py";
    
    const command = `source \"./../venv/bin/activate\" && cd ../ && CUDA_VISIBLE_DEVICES=1 python3 "${scripPath}" --batch_size="8" --general_threshold=0.35 --character_threshold=0.35 --caption_extension=".txt" --model="SmilingWolf/wd-v1-4-convnextv2-tagger-v2" --max_data_loader_n_workers="2" --remove_underscore "${dataDir}"`;

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
