import { ServerWebSocket } from 'bun';
import { renderToReadableStream, renderToString } from 'react-dom/server';
import { mkdir, readdir } from 'fs/promises';
import { VscChevronDown } from 'react-icons/vsc'
import {
  ChildProcess,
  spawn,
} from 'child_process';
import { dirname, extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import chokidar from 'chokidar';
import { getHighlighter } from 'shikiji';
import React, { ReactElement } from 'react';
import { Command } from 'commander';

import train_network_args_raw from './args/train_network_args.json'
import lora_config from './presets/config.json'

const exclude_args
= [
  'pretrained_model_name_or_path',
  'train_data_dir',
  'output_dir',
  'logging_dir',
  // 'save_model_as',
  'output_name',
  'caption_extension',
  'sample_prompts',
]

// const defaultValueOverrides = {
//   'caption_extention': '.txt',
//   'enable_bucket': true,
//   'min_bucket_reso': 256,
//   'max_bucket_reso': 2048,
//   'resolution': "512,512",
//   'lr_scheduler_num_cycles': "10",
//   'learning_rate': "1.0",
//   'lr_scheduler': 'constant',
//   'train_batch_size': '8',
//   'max_train_steps': '1250',
//   'save_every_n_epochs': '1',
//   'mixed_precision': 'fp16',
//   'save_precision': 'fp16'
//   // 'save_model_as': "safetensors"
// }

const commandArgs = '--resolution="512,512" --enable_bucket --min_bucket_reso=256 --max_bucket_reso=2048 --lr_scheduler_num_cycles="10"  --learning_rate="1.0" --lr_scheduler="constant" --train_batch_size="8" --max_train_steps="1250" --save_every_n_epochs="1" --mixed_precision="fp16" --save_precision="fp16" --cache_latents --optimizer_type="Prodigy" --max_data_loader_n_workers="0" --bucket_reso_steps=64 --flip_aug --xformers --bucket_no_upscale --noise_offset=0.0 --sample_sampler=euler_a --sample_every_n_steps="128" --network_alpha="1" --network_module=lycoris.kohya --network_args "conv_dim=64" "conv_alpha=1" "algo=locon" --text_encoder_lr=1.0 --unet_lr=1.0 --network_dim=64 --no_half_vae';

const argsArray = commandArgs.split('--').filter(Boolean);
const defaultValueOverrides = {} as any;

argsArray.forEach(arg => {
  if (arg.includes("network_args")) {
    const [key, ...values] = arg.trim().split(' ');
    defaultValueOverrides[key.trim()] = values.join(' ');
    return;
  }
  const [key, value] = arg.replace(/"/g, '').trim().split('=');
  defaultValueOverrides[key.trim()] = value ? value.replace(/"/g, '').trim() : true;
});

Object.entries(lora_config).forEach(([key, value]) => {
  if (defaultValueOverrides[key]) {
    defaultValueOverrides[key] = value;
  }
});

// console.log('defaultValueOverrides', defaultValueOverrides);

const mapArguments =  () => {
  defaultValueOverrides['resolution'] = lora_config['max_resolution'];

  if (lora_config["LoRA_type"] === 'LoCon' || lora_config["LoRA_type"] === 'LyCORIS/LoCon') {
    defaultValueOverrides["network_module"] = "lycoris.kohya";
    defaultValueOverrides["network_args"] = `conv_dim=${lora_config['conv_dim']} conv_alpha=${lora_config['conv_alpha']} algo=locon`;
  }

  if (lora_config["LoRA_type"] === 'LyCORIS/LoHa') {
    defaultValueOverrides["network_module"] = "lycoris.kohya";
    defaultValueOverrides["network_args"] = `conv_dim=${lora_config['conv_dim']} conv_alpha=${lora_config['conv_alpha']} use_cp=${lora_config['use_cp']} algo=loha`;
    if (lora_config['network_dropout'] > 0) {
      defaultValueOverrides["network_dropout"] = lora_config['network_dropout'];
    }
  }

  if (lora_config["LoRA_type"] === 'LyCORIS/iA3') {
    defaultValueOverrides["network_module"] = "lycoris.kohya";
    defaultValueOverrides["network_args"] = `conv_dim=${lora_config['conv_dim']} conv_alpha=${lora_config['conv_alpha']} train_on_input=${lora_config['train_on_input']} algo=ia3`;
    if (lora_config['network_dropout'] > 0) {
      defaultValueOverrides["network_dropout"] = lora_config['network_dropout'];
    }
  }

  if (lora_config["LoRA_type"] === 'LyCORIS/DyLoRA') {
    defaultValueOverrides["network_module"] = "lycoris.kohya";
    defaultValueOverrides["network_args"] = `conv_dim=${lora_config['conv_dim']} conv_alpha=${lora_config['conv_alpha']} use_cp=${lora_config['use_cp']} block_size=${lora_config['unit']} algo=dylora`;
    if (lora_config['network_dropout'] > 0) {
      defaultValueOverrides["network_dropout"] = lora_config['network_dropout'];
    }
  }

  if (lora_config["LoRA_type"] === 'LyCORIS/DyLoRA') {
    defaultValueOverrides["network_module"] = "lycoris.kohya";
    defaultValueOverrides["network_args"] = `conv_dim=${lora_config['conv_dim']} conv_alpha=${lora_config['conv_alpha']} use_cp=${lora_config['use_cp']} factor=${lora_config['factor']} algo=lokr`;
    if (lora_config['network_dropout'] > 0) {
      defaultValueOverrides["network_dropout"] = lora_config['network_dropout'];
    }
  }

  if (lora_config["LoRA_type"] === 'Kohya LoCon' || lora_config["LoRA_type"] === "Standard" || lora_config["LoRA_type"] === 'LoRA-FA') {
    if (lora_config["LoRA_type"] === 'LoRA-FA') {
      defaultValueOverrides["network_module"] = "networks.lora_fa";
    } else {
      defaultValueOverrides["network_module"] = "networks.lora";
    }

    const kohya_lora_var_list = [
      'down_lr_weight',
      'mid_lr_weight',
      'up_lr_weight',
      'block_lr_zero_threshold',
      'block_dims',
      'block_alphas',
      'conv_block_dims',
      'conv_block_alphas',
      'rank_dropout',
      'module_dropout',
    ]

    for (const key of kohya_lora_var_list) {
      if ((lora_config as any)[key]) {
        defaultValueOverrides[key] = (lora_config as any)[key];
      }
    }
  }

  if (lora_config["LoRA_type"] === 'Kohya DyLoRA') {
    defaultValueOverrides["network_module"] = "networks.dylora";

    const kohya_lora_var_list = [
      'conv_dim',
      'conv_alpha',
      'down_lr_weight',
      'mid_lr_weight',
      'up_lr_weight',
      'block_lr_zero_threshold',
      'block_dims',
      'block_alphas',
      'conv_block_dims',
      'conv_block_alphas',
      'rank_dropout',
      'module_dropout',
      'unit',
    ]

    for (const key of kohya_lora_var_list) {
      if ((lora_config as any)[key]) {
        defaultValueOverrides[key] = (lora_config as any)[key];
      }
    }
  }

  defaultValueOverrides["network_dim"] = lora_config["network_dim"];

  if (lora_config['lora_network_weights'] !== '') {
    defaultValueOverrides['network_weights'] = lora_config['lora_network_weights'];
  }

  if (lora_config['lr_scheduler_num_cycles'] !== '') {
    defaultValueOverrides['lr_scheduler_num_cycles'] = lora_config['lr_scheduler_num_cycles'];
  } else {
    defaultValueOverrides['lr_scheduler_num_cycles'] = lora_config['epoch'];
  }

  if (lora_config['sdxl_cache_text_encoder_outputs']) {
    defaultValueOverrides['cache_text_encoder_outputs'] = true;
  }

  if (lora_config['sdxl_no_half_vae']) {
    defaultValueOverrides['no_half_vae'] = true;
  }
}

mapArguments();

const train_network_args = Object.fromEntries(
  Object.entries(train_network_args_raw).filter(([key, value]) => !exclude_args.includes(key))
)

Object.entries(defaultValueOverrides).forEach(([key, value]) => {
  if (train_network_args[key]) {
    // @ts-ignore
    train_network_args[key].default = value;
  }
});

// Object.defineProperty(train_network_args, 'CUDA_VISIBLE_DEVICES', {
//   value: {
//     type: 'number',
//     default: 0,
//   }
// })

// {
//   name: 'CUDA_VISIBLE_DEVICES',
//   type: 'number',
//   default: 0,
// },

// const command = `source \"kohya_ss/venv/bin/activate\" && python get_args.py` ;
// let cmdarray = command.split(' ');
// const result = spawnSync(cmdarray.shift()!, cmdarray, {
//   shell: true,
// });
// console.log("Args: ", result.stdout.toString())

const shiki = await getHighlighter({
  themes: ['nord'],
  langs: ['bash'],
});

export interface Plugin {
  getName: () => string;
  handleRequest?(req: Request): Promise<Response> | Response | undefined;
  getFormUI?(): React.ReactNode;
  getHeaderUI?(): React.ReactNode;
  onFilesUploaded?(props: {
    folderPaths: FolderPaths
    formdata: FormData
  }): Promise<void> | void;
  onRun?(props: {
      folderPaths: FolderPaths
  }): Promise<void> | void;
}

import fs from 'fs';
import path from 'path';

const pluginsDir = path.join(import.meta.dir, 'plugins');
let pluginFiles = fs.readdirSync(pluginsDir);

pluginFiles = pluginFiles.filter(file => {
  const ext = path.extname(file);
  return ext === '.ts' || ext === '.tsx';
});

const allPlugins = (await Promise.all(pluginFiles.map(x => import('./plugins/' + x)))).map(x => (x.default as () => Plugin)());
// console.log("Plugins Loaded: ", allPlugins.map(x => x.getName()));

const program = new Command();

program.option('--ckpt-dir')
program.option('--debug')
program.parse();

const options = program.opts();
export let debug = options.debug ? true : false

export let checkpoints = program.args[0]

if(!checkpoints && !debug) {
  console.error('ckpt dir cannot be null!')
  process.exit()
}

// console.log(debug);

declare global {
  var restartCount: number;
  var firstTime: boolean;
  var runCount: number;
  var loraProc: ChildProcess | undefined; //Subprocess;
  var folderPaths: FolderPaths | undefined;
  var advanceParams: FormData | undefined;

  var allClients: Record<
    string,
    {
      ws: ServerWebSocket<WebSocketData>;
      // folderName: string;
      runId?: string;
      watcher?: chokidar.FSWatcher;
    }
  >;
}

if (!globalThis.firstTime) {
  globalThis.firstTime = true;
  globalThis.restartCount = 0;
  globalThis.runCount = 0;

  globalThis.allClients = {};

  process.on('exit', async () => {
    await Promise.all(
      Object.values(globalThis.allClients).map((x) => {
        return x.watcher?.close();
      }),
    );
    if (globalThis.loraProc) {
      console.log('killing ' + globalThis.loraProc.pid);
      spawn('sh', ['-c', 'kill -INT -' + globalThis.loraProc.pid]);
    }
    process.exit();
  });
  process.on('SIGINT', async () => {
    await Promise.all(
      Object.values(globalThis.allClients).map((x) => {
        return x.watcher?.close();
      }),
    );
    if (globalThis.loraProc) {
      console.log('killing ' + globalThis.loraProc.pid);
      spawn('sh', ['-c', 'kill -INT -' + globalThis.loraProc.pid]);
    }
    process.exit();
  });
} else {
  globalThis.restartCount++;
}

export let modelFolders = checkpoints;

let folderPath = debug
  ? ['chilloutmix-Ni-pruned-fp32.safetensors']
  : (await readdir(modelFolders)).filter((x) => x.endsWith('safetensors'));
// let folderPath = ["chilloutmix-Ni-pruned-fp32.safetensors"]

const train_network_args_values = Object.fromEntries(Object.entries(train_network_args).map(([key, param]) => {
  return [key, param.default]
}))
// console.log(train_network_args_values);

const presets = {
  "man": {
    name: "man",
    ...train_network_args_values
  },
  "girl": {
    name: "girl",
    ...train_network_args_values
  }
}

function Component({sessionId}: { sessionId: string }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Fast Lora Trainer</title>
        <link rel="stylesheet" href="index.css" />
        <script src="https://unpkg.com/htmx.org@1.9.6"></script>
        <script src="https://unpkg.com/hyperscript.org@0.9.11"></script>
        <script src="https://unpkg.com/htmx.org/dist/ext/ws.js"></script>
        <script src="https://unpkg.com/htmx.org/dist/ext/debug.js"></script>
        <script src="./utils"></script>
      </head>
      <body>
        <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="flex h-[100dvh]">
          <div className="flex flex-col items-center px-2 w-[310px] min-w-[310px]">
            <div className='flex items-center justify-between w-full'>
            <h1
              hx-ext="ws"
              ws-connect={`/ws?sessionId=${sessionId}`}
              className="text-xl my-4"
            >
              Fast Lora Trainer
            </h1>
            <div className="dropdown dropdown-end">
            <label
              tabIndex={0}
              className="text-xs font-bold m-1 cursor-pointer hover:ring-1 rounded-xl px-1 ring-gray-400 flex items-center gap-2"
            >
              Preset <VscChevronDown />
            </label>
            <ul
              tabIndex={0}
              className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-fit"
            >
              {
                Object.entries(presets).map(([key, x]) => <li>
                  <a _={`on click call applyPreset('form', '${key}') call document.activeElement.blur()`}>
                    {key}
                  </a>
                </li>)
              }
            </ul>
          </div>
            </div>
            {/* <form > */}
            <form
              id="form"
              hx-encoding="multipart/form-data"
              hx-post="/upload"
              hx-swap="innerHTML"
              hx-target="#upload-button"
              className="flex flex-col gap-1 overflow-y-auto flex-grow h-fit"
              // hx-trigger="click target:#upload-button"
              hx-disinherit="hx-target"
              // @ts-ignore
              _="on submit localStorage.setItem('base_model', my.base_model.value) then localStorage.setItem('name', my.name.value) then localStorage.setItem('instance_name', my.instance_name.value) then localStorage.setItem('class_name', my.class_name.value) then localStorage.setItem('repeat_step', my.repeat_step.value)
              on htmx:xhr:progress(loaded, total) 
              if (loaded/total)*100 != Infinity
                set #progress.value to (loaded/total)*100
              console.log((loaded/total)*100)
            "
            >
              <select
                className="select select-sm select-bordered w-full max-w-xs"
                name="base_model"
                id="base_model"
                placeholder="base_model"
                defaultValue="chilloutmix-Ni-pruned-fp32.safetensors"
                // _="on load set my.value to localStorage.getItem('base_model')"
              >
                {/* <option disabled>
                Pick your favorite Simpson
              </option> */}
                {folderPath.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              {/* <input
              type="text"
              className="input input-bordered w-full max-w-xs"
              name="base_model"
              placeholder="base_model"
            /> */}

              <input
                required
                type="text"
                className="input input-sm input-bordered w-full max-w-xs"
                name="name"
                id="name"
                placeholder="lora_name: mylora"
                defaultValue=""
                // _="on load set my.value to localStorage.getItem('form')"
              />

              <input
                required
                type="text"
                className="input input-sm input-bordered w-full max-w-xs"
                name="instance_name"
                id="instance_name"
                placeholder="instance_name: asd | ... "
                defaultValue=""
                // _="on load set my.value to localStorage.getItem('instance_name')"
              />

              <input
                required
                type="text"
                className="input input-sm input-bordered w-full max-w-xs"
                name="class_name"
                id="class_name"
                placeholder="class_name: man | girl | boy ..."
                defaultValue=""
                // _="on load set my.value to localStorage.getItem('class_name')"
              />
              <input
                required
                type="number"
                className="input input-sm input-bordered w-full max-w-xs"
                name="repeat_step"
                id="repeat_step"
                placeholder="repeat_step"
                defaultValue="40"
                // _="on load set my.value to localStorage.getItem('repeat_step')"
              />
              <input
                required
                type="file"
                className="file-input file-input-bordered file-input-sm w-full max-w-xs min-h-[40px]"
                id="files"
                name="files"
                multiple
              />

              <Collapse heading={
                  <span className="label-text">Advance Params</span>
              }
              smallerHeading
              >
                <>
                  <label className="label-text">CUDA_VISIBLE_DEVICES</label>
                  <input
                    type={"number"}
                    name={"CUDA_VISIBLE_DEVICES"}
                    className="input input-sm input-bordered w-full max-w-xs"
                    defaultValue={0}
                  />
                </>
                {Object.entries(train_network_args).map(([key, param], index) => (
                    <div key={index}>
                      {param.default === false || param.default === true ? (
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <span className="label-text">{key}</span>
                            <input
                              type="checkbox"
                              name={key}
                              className="toggle"
                              defaultChecked={param.default}
                            />
                          </label>
                        </div>
                      ) :  (param.choices != null) ? (
                        <>
                          <label className="label-text">{key}</label>
                          <select
                            className="select select-sm select-bordered w-full max-w-xs"
                            name={key}
                            defaultValue={String(param.default)}
                          >
                            {param.choices.map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </>
                      ) :
                      (
                        <>
                          <label className="label-text">{key}</label>
                          <input
                            type={(param.type == "float" || param.type == "int") ? "number" : "text"}
                            name={key}
                            className="input input-sm input-bordered w-full max-w-xs"
                            defaultValue={param.default != null ? param.default : ""}
                          />
                        </>
                      )}
                    </div>
                  ))}
              </Collapse>
{/* 
              <div className="collapse bg-base-200 h-fit ">
                <input type="checkbox" />
                <div className="collapse-title ">
                  <span className="label-text">Advance Params</span>
                </div>
                <div className="collapse-content overflow-y-auto">
                 
                </div>
              </div> */}

              {allPlugins.map((x) => x.getFormUI?.())}

              <TextAreaOptions
                title="Sampling"
                name="sample_prompt"
                options={[
                  {
                    name: "Man",
                    value:
                      "masterpiece, best quality, 1man, upper body, looking at viewer, simple background --n low quality, worst quality, bad anatomy, bad composition, poor, low effort --w 512 --h 512 --d 1 --l 8 --s 30",
                  },
                  {
                    name: "Girl",
                    value:
                      "masterpiece, best quality, 1girl, upper body, looking at viewer, simple background --n low quality, worst quality, bad anatomy, bad composition, poor, low effort --w 512 --h 512 --d 1 --l 8 --s 30",
                  },
                ]}
              />
            </form>

            {/* <div className='w-full absolute bottom-0'> */}
            <div className="w-full flex">
              <button
                id="upload-button"
                type="submit"
                className="btn grow"
                _="on click send 'submit' to #form"
              >
                Upload
              </button>
              <StartButton />
            </div>
            <progress
              id="progress"
              className="w-full progress  mb-2"
              value="0"
              max="100"
            ></progress>
            {/* </div> */}
          </div>
          <div className="divider divider-horizontal !-mx-[5px]"/>

          
            <div className=" w-full flex flex-col">
              <div id={'header'}>
              <div className='flex justify-end w-full items-center'>
                {allPlugins.map((x) => x.getHeaderUI?.())}
              </div>
              <div className="divider !my-0 h-[1px]"/>
              </div>
              <Container/>
          </div>
        </div>
      </body>
    </html>
  );
}

function TextAreaOptions(props: { options: {
  name: string,
  value: string,
}[]; name: string, title: string }) {
  return (
    <div className="form-control w-full max-w-xs">
      <label className="label">
        <span className="label-text text-xs">{props.title}</span>
        <span className="label-text-alt">
          <div className="dropdown dropdown-end">
            <label
              tabIndex={0}
              className="m-1 cursor-pointer hover:ring-1 rounded-xl px-1 ring-gray-400 flex items-center gap-2"
            >
              Preset <VscChevronDown />
            </label>
            <ul
              tabIndex={0}
              className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-fit"
            >
              {
                props.options.map(x => <li>
                  <a _={`on click set #sample_prompt.value to '${x.value}' call document.activeElement.blur()`}>
                    {x.name}
                  </a>
                </li>)
              }
            </ul>
          </div>
        </span>
      </label>
      <textarea
        id={props.name}
        className="textarea textarea-bordered textarea-sm w-full max-w-xs leading-tight h-20"
        name={props.name}
        placeholder={props.name}
        defaultValue={
          props.options[0].value
        }
      />
    </div>
  );
}

function StartButton({ text = 'Start' }: { text?: React.ReactNode }) {
  return (
    <button
      // hx-ext="debug"
      type="button"
      // id="start-btn"
      className="btn btn-accent"
      hx-post="./start"
      hx-swap="outerHTML"
      hx-params="none"
    >
      {text}
    </button>
  );
}

function Container() {
  return (
      <div
      id="run-container"
      className={`flex flex-col-reverse grow justify-end h-full`}
    />
  );
}

export type FolderPaths = {
  base_model: string;
  modelName: string;
  img: string;
  img_root: string;
  model: string;
  sample_prompt: string;
  log: string;
};

function getCommandsParams() {
  const formdata = globalThis.advanceParams;

  if (!formdata) return "";

  let commandParams = "";

  for (const [key,param] of Object.entries(train_network_args)) {
    const value = formdata.get(key);
    if (key == "CUDA_VISIBLE_DEVICES") continue;
    if (key == ("network_args")) {
      commandParams += `--${key} ${value} `;
      continue
    }
    if ((param.default == true || param.default == false) && param.type == null) {
      if (value == null) continue;
      else if (value == 'on') {
        commandParams += `--${key} `;
      }
    } else if (value !== null && value !== undefined && value !== "" && value !== "null") {
      commandParams += `--${key}="${value}" `;
    }
  }

  return commandParams.trim(); // remove trailing space
}

function startLoraTraining(folderPaths: FolderPaths) {
  let p = path.resolve(import.meta.dir, '..', '..')
  let currentFolder = path.resolve(import.meta.dir, '..', )

  let trainNetworkPath = path.join(p, 'train_network.py');
  let venvPath = ""
  if (fs.existsSync(trainNetworkPath)) {
    trainNetworkPath = path.join(p, 'train_network.py');
    venvPath = path.join(p, 'venv', 'bin', 'activate');
  } else {
    trainNetworkPath = path.join(currentFolder, 'kohya_ss', 'train_network.py');
    venvPath = path.join(currentFolder, 'kohya_ss', 'venv', 'bin', 'activate');
  }

  const modelPath = modelFolders + folderPaths.base_model;
  const dataDir = join(dirname(__dirname), folderPaths.img_root); //"/home/avatech/Desktop/projects/kohya_ss/dataset/img";
  const outputDir = join(dirname(__dirname), folderPaths.model); //"/home/avatech/Desktop/projects/kohya_ss/dataset/model";
  const loggingDir = join(dirname(__dirname), folderPaths.log);
  const modelName = folderPaths.modelName;
  const samplePromptPath = join(dirname(__dirname), folderPaths.sample_prompt); //"/home/avatech/Desktop/projects/kohya_ss/dataset/model/sample/prompt.txt";

  const scripPath = trainNetworkPath;

  // const command = `source \"./../venv/bin/activate\" && CUDA_VISIBLE_DEVICES=1 accelerate launch --num_cpu_threads_per_process=2 "${scripPath}" --enable_bucket --min_bucket_reso=256 --max_bucket_reso=2048 --pretrained_model_name_or_path="${modelPath}" --train_data_dir="${dataDir}" --resolution="512,512" --output_dir="${outputDir}" --logging_dir="${loggingDir}" --save_model_as=safetensors --output_name="${modelName}" --lr_scheduler_num_cycles="1" --max_data_loader_n_workers="0" --learning_rate="0.0001" --lr_scheduler="cosine" --lr_warmup_steps="595" --train_batch_size="2" --max_train_steps="5950" --save_every_n_epochs="1" --mixed_precision="fp16" --save_precision="fp16" --seed="7" --caption_extension=".txt" --cache_latents --optimizer_type="AdamW" --max_data_loader_n_workers="0" --clip_skip=2 --bucket_reso_steps=64 --flip_aug --xformers --bucket_no_upscale --noise_offset=0.0 --sample_sampler=euler_a --sample_prompts="${samplePromptPath}" --sample_every_n_steps="128"`;
  const command = `source \"${venvPath}\" && CUDA_VISIBLE_DEVICES=${globalThis.advanceParams?.get('CUDA_VISIBLE_DEVICES')} accelerate launch --num_cpu_threads_per_process=2 "${scripPath}" --pretrained_model_name_or_path="${modelPath}" --train_data_dir="${dataDir}" --output_dir="${outputDir}" --logging_dir="${loggingDir}" --save_model_as=safetensors --output_name="${modelName}" --caption_extension=".txt" --sample_prompts="${samplePromptPath}" ${getCommandsParams()}` ;

  console.log(command);
  globalThis.runCount++;

  if (debug) return command;

  let cmdarray = command.split(' ');
  globalThis.loraProc = spawn(cmdarray.shift()!, cmdarray, {
    stdio: 'inherit',
    shell: true,
    detached: true,
  });

  return command;
}

async function Comp(children: React.ReactNode) {
  return new Response(await renderToReadableStream(children), {
    headers: { 'Content-Type': 'text/html' },
  });
}

function CompToString(children: ReactElement) {
  return renderToString(children);
}

type WebSocketData = 
  | { sessionId: string; folderName?: never; runId?: never }
  | { sessionId?: never; folderName: string; runId: string };

function Collapse(
  props : React.ComponentProps<'div'> & {
    heading: React.ReactNode;
    smallerHeading?: boolean;
  },
) {
  return (
    <div className="border-x-0 border-y-1 border border-base-300 visible relative">
      <input
        type="checkbox"
        className={
          'w-full appearance-none absolute cursor-pointer translate-y-0 ' +
          (props.smallerHeading ? ' h-[28px]' : ' h-[60px]')
        }
        hx-on:click="['!h-fit', '!visible', '!opacity-100', '!translate-y-0'].map(v=> this.nextElementSibling.nextElementSibling.classList.toggle(v) ) "
      />
      <div
        className={
          'collapse-title items-center text-xl font-medium !flex !opacity-100 justify-between pointer-events-none ' +
          (props.smallerHeading ? ' !p-1 !min-h-fit' : '')
        }
      >
        {props.heading}
      </div>
      <div className="w-full h-0 invisible flex-col items-start opacity-0 transition-all -translate-y-2 overflow-hidden">
        <div className="px-2 pb-2">{props.children}</div>
      </div>
    </div>
  );
}

Bun.serve<WebSocketData>({
    websocket: {
    async open(ws) {
      console.log(ws.data);

      if (ws.data.sessionId) {
        globalThis.allClients[ws.data.sessionId] = {
          ws,
        };
        return 
      }

      const folder = `data/${ws.data.folderName}/model/sample`;
      console.log('connected + ' + ws.data.runId, folder);

      const watcher = chokidar.watch(folder, {
        ignored: /^\./,
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('add', async (filepath) => {
        // console.log('add ', filepath, extname(filepath));

        if (
          extname(filepath) === '.jpg' ||
          extname(filepath) === '.jpeg' ||
          extname(filepath) === '.png'
        ) {
          // // delay to wait for file to be written
          await new Promise((resolve) => setTimeout(resolve, 1000));

          ws.send(`
            <div id="image-container-${ws.data.runId}" hx-swap-oob="beforeend" >
            <img src="./image/${encodeURI(filepath)}"/>
            </div>
          `);
        }
      });

      if (ws.data.runId)
        globalThis.allClients[ws.data.runId] = {
          ws,
          runId: ws.data.runId,
          watcher,
        };
    },
    async close(ws) {
      if (ws.data.runId) {
        await globalThis.allClients[ws.data.runId].watcher?.close();
        console.log('Removing', globalThis.allClients[ws.data.runId].runId);
        delete globalThis.allClients[ws.data.runId];
      }
      if (ws.data.sessionId) {
        console.log('Removing', ws.data.sessionId);
        delete globalThis.allClients[ws.data.sessionId];
      }
    },
    message(ws, message) {},
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    const params = url.searchParams;

    if (url.pathname === '/ws') {
      const sessionId = params.get('sessionId')

      if (sessionId) {
        server.upgrade(req, {
          headers: {
            "Set-Cookie": `SessionId=${sessionId}`,
          },
          data: {
            sessionId
          } as WebSocketData,
        });
      } else {
        server.upgrade(req, {
          headers: {
            "Set-Cookie": `SessionId=${sessionId}`,
          },
          data: {
            folderName: params.get('folder')!,
            runId: params.get('runId')!,
          } as WebSocketData,
        });
      }
    }

    // return index.html for root path
    if (url.pathname === '/') {
      const sessionId = generateSessionId();
      return Comp(<Component sessionId={sessionId} />);
    }

    if (url.pathname === "/container") {
      return Comp(<Container />);
    }

    console.log(url.pathname);

    if (url.pathname === '/index.css') {
      return new Response(Bun.file('output.css'), {
        headers: {
          'Content-Type': 'text/css',
        },
      });
    } else if (url.pathname === '/utils') {
      return new Response(Bun.file('src/utils.js'), {
        headers: {
          'Content-Type': 'text/javascript',
        },
      });
    }

    for (const key in presets) {
      if (url.pathname === '/' + key + '.json') {
        return new Response(JSON.stringify((presets as any)[key]), {
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } 
    }

    // parse formdata at /upload
    if (url.pathname === '/upload') {
      const formdata = await req.formData();
      const name = formdata.get('name') as string;
      const base_model = formdata.get('base_model') as string;
      const class_name = formdata.get('class_name') as string;
      const instance_name = formdata.get('instance_name') as string;
      const sample_prompt = formdata.get('sample_prompt') as string;
      const repeat_step = Number.parseInt(
        formdata.get('repeat_step') as string,
      );

      globalThis.advanceParams = formdata;

      const folderName = `${repeat_step}_${instance_name} ${class_name}`;

      let temp = {
        img: `data/${name}/img/${folderName}`,
        img_root: `data/${name}/img`,
        log: `data/${name}/log`,
        model: `data/${name}/model`,
      };

      await Promise.allSettled(
        Object.values(temp).map((x) => {
          return mkdir(`${x}`, {
            recursive: true,
          });
        }),
      );

      globalThis.folderPaths = {
        modelName: name,
        base_model: base_model,
        sample_prompt: `data/${name}/prompt.txt`,
        ...temp,
      };

      await Bun.write(globalThis.folderPaths.sample_prompt, sample_prompt);

      const filesOps: Promise<unknown>[] = [];
      formdata.getAll('files').forEach((x, i) => {
        let fileType = (x as Blob).type.replace('image/', '.');
        if (fileType == '.jpeg') fileType = '.jpg';

        let filePath = globalThis.folderPaths?.img + '/image_' + i + fileType;
        // console.log(filePath);

        filesOps.push(Bun.write(filePath, x));
      });
      await Promise.allSettled(filesOps);

      const sessionId = req.headers.get("cookie")?.match(/SessionId=([^;]*)/)?.[1];

      // console.log(req.headers);

      if (sessionId) {
        globalThis.allClients[sessionId].ws.send(
          CompToString(
            <div id='upload-button' className='btn' hx-swap-oob="innerHTML">
              <div className="text-orange-400 text-sm normal-case">Pre Processing...</div>
            </div>,
          ),
        );
      }

      // await new Promise(resolve => setTimeout(resolve, 2000));

      const allPluginPreprocesses = allPlugins.map(x => x.onFilesUploaded?.(
        {
          folderPaths: globalThis.folderPaths!,
          formdata: formdata
        }
      ))
      await Promise.allSettled(allPluginPreprocesses);

      return Comp(
        <div>
          Upload{' '}
          <div className="text-green-600 text-sm normal-case">Success</div>
        </div>,
      );
    }

    if (url.pathname.startsWith('/image')) {
      let file = url.pathname.replace('/image/', '');
      console.log(file);

      // exists(file, (exists) => {
      //   console.log(exists);
      // })

      return new Response(Bun.file(decodeURI(file)));
    }

    if (url.pathname === '/start') {
      const allPluginPreprocesses = allPlugins.map(x => x.onRun?.({
          folderPaths: globalThis.folderPaths!
      }))
      await Promise.allSettled(allPluginPreprocesses);

      const folderPaths = globalThis.folderPaths;
      if (folderPaths) {
        const command = startLoraTraining(folderPaths);
        const code = shiki.codeToHtml(command, { lang: 'bash', theme: 'nord' });
        const runId = generateSessionId();

        return Comp(
          <>
            <button
              // id="stop-btn"
              className="btn btn-error"
              hx-post={'./stop?runId=' + runId}
              // hx-swap-oob="false"
              hx-swap="outerHTML"
            >
              Stop
            </button>

            <div id="run-container" hx-swap-oob="beforeend">
              <Collapse
                heading={
                  <>
                    <span>
                      Run #{globalThis.runCount}{' '}
                      <span className="text-sm text-gray-500">{runId}</span>
                    </span>
                    <span id={`status-${runId}`} className="text-sm">
                      Running...
                    </span>
                  </>
                }
              >
                <div className="w-full text-sm">
                  <Collapse
                    smallerHeading
                    heading={
                      <span className="text-xs">
                        Expand to see running command
                      </span>
                    }
                  >
                    <p
                      dangerouslySetInnerHTML={{
                        __html: code,
                      }}
                    ></p>
                  </Collapse>
                </div>
                <div
                  hx-ext="ws"
                  ws-connect={`/ws?runId=${runId}&folder=${folderPaths.modelName}`}
                >
                  <div
                    id={`image-container-${runId}`}
                    className="grid grid-cols-3"
                  ></div>
                </div>
              </Collapse>
              {/* <div className="border border-base-300 visible relative">
                <input
                  type="checkbox"
                  className="w-full h-[60px] appearance-none absolute cursor-pointer translate-y-0"
                  hx-on:click="['!h-fit', '!visible', '!opacity-100', '!translate-y-0'].map(v=> this.nextElementSibling.nextElementSibling.classList.toggle(v) ) "
                />
                <div className="collapse-title text-xl font-medium !flex !opacity-100 justify-between pointer-events-none">
                  <span>
                    Run #{globalThis.runCount}{' '}
                    <span className="text-sm text-gray-500">{runId}</span>
                  </span>
                  <span id={`status-${runId}`} className="text-sm">
                    Running...
                  </span>
                </div>
                <div className="w-full h-0 !min-h-fit invisible flex-col items-start opacity-0 transition-all -translate-y-2">
                  <div className="px-2 pb-2">
                    <div className="w-full">
                      <p
                        dangerouslySetInnerHTML={{
                          __html: code,
                        }}
                      ></p>
                    </div>
                    <div
                      hx-ext="ws"
                      ws-connect={`/ws?runId=${runId}&folder=${folderPaths.modelName}`}
                    >
                      <div
                        id={`image-container-${runId}`}
                        className="grid grid-cols-3"
                      ></div>
                    </div>
                  </div>
                </div>
              </div> */}
            </div>
          </>,
        );
      } else {
        return Comp(
          <StartButton
            text={
              <div>
                Start
                <div className="text-red-700 normal-case text-sm">
                  Upload First
                </div>
              </div>
            }
          />,
        );
      }
    }

    if (url.pathname === '/stop') {
      let runId = params.get('runId');
      // <span id={`${runId}-status`} className="text-sm">Running...</span>

      globalThis.allClients[runId!].ws.send(
        CompToString(
          <span
            id={`status-${runId}`}
            className="text-sm text-red-700 text-center h-fit"
            hx-swap-oob="true"
          >
            {' '}
            Stopped
          </span>,
        ),
      );

      globalThis.allClients[runId!].ws.close(1000);

      if (globalThis.loraProc && !globalThis.loraProc.killed) {
        // loraProc.kill('SIGINT');
        // process.kill(loraProc.pid! + 1, 'SIGINT')
        spawn('sh', ['-c', 'kill -INT -' + globalThis.loraProc.pid]);
        loraProc = undefined;
        // await loraProc.;
        return Comp(<StartButton />);
      }
      return Comp(<StartButton />);
    }

    for (const key in allPlugins) {
      const plugin = allPlugins[key]
      if (plugin.handleRequest) {
        const response = await plugin.handleRequest?.(req);
        if (response) return response;
      }
    }

    return new Response('Not Found', { status: 404 });
  },
});

function generateSessionId() {
  return uuidv4();
}
