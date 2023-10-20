import { ServerWebSocket, Subprocess } from "bun";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { mkdir, readdir } from "fs/promises";
import {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  spawn,
} from "child_process";
import { dirname, extname, join, relative } from "path";
// import { cache } from 'react'
import { v4 as uuidv4 } from "uuid";
import chokidar from "chokidar";
import { exists, readFileSync } from "fs";
import { argv } from "process";

import { getHighlighter } from 'shikiji'
import { startCaptioning } from "./captioning";
import { render } from "react-dom";
import { ReactElement } from "react";

const shiki = await getHighlighter({
  themes: ['nord'],
  langs: ['bash'],
})

export let debug = (argv.length >= 3 && argv[2] == "--debug") ?? false

console.log(debug);

declare global {
  var restartCount: number;
  var firstTime: boolean;
  var runCount: number;
  var loraProc: ChildProcess | undefined; //Subprocess;
  var folderPaths: FolderPaths | undefined;

  var allClients: Record<
    string,
    {
      ws: ServerWebSocket<WebSocketData>;
      // folderName: string;
      runId: string;
      watcher: chokidar.FSWatcher;
    }
  >;
}

if (!globalThis.firstTime) {
  globalThis.firstTime = true;
  globalThis.restartCount = 0;
  globalThis.runCount = 0;

  globalThis.allClients = {};

  process.on("exit", async () => {
    await Promise.all(Object.values(globalThis.allClients).map(x => {
      return x.watcher?.close()
    }))
    if (globalThis.loraProc) {
      console.log("killing " + globalThis.loraProc.pid);
      spawn("sh", ["-c", "kill -INT -" + globalThis.loraProc.pid]);
    }
    process.exit();
  });
  process.on("SIGINT", async () => {
    await Promise.all(Object.values(globalThis.allClients).map(x => {
      return x.watcher?.close()
    }))
    if (globalThis.loraProc) {
      console.log("killing " + globalThis.loraProc.pid);
      spawn("sh", ["-c", "kill -INT -" + globalThis.loraProc.pid]);
    }
    process.exit();
  });
} else {
  globalThis.restartCount++;
}

export let modelFolders =
  "/home/avatech/Desktop/projects/stable-diffusion-webui/models/Stable-diffusion/";

let folderPath = debug ? ["chilloutmix-Ni-pruned-fp32.safetensors"] : (await readdir(modelFolders)).filter((x) =>
  x.endsWith("safetensors")
);
// let folderPath = ["chilloutmix-Ni-pruned-fp32.safetensors"]

function Component(props: { message: string }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Fast Lora Trainer</title>
        <link rel="stylesheet" href="index.css" />
        <script src="https://unpkg.com/htmx.org@1.9.6"></script>
        <script src="https://unpkg.com/hyperscript.org@0.9.11"></script>
        <script src="https://unpkg.com/htmx.org/dist/ext/ws.js"></script>
      </head>
      <body>
        <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="flex h-[100dvh]">
          <div className="flex flex-col items-center px-2 w-[310px] min-w-[310px]">
            <h1 className="text-xl mt-4">Fast Lora Trainer</h1>
            {/* <form > */}
            <form
              id="form"
              hx-encoding="multipart/form-data"
              hx-post="/action"
              hx-swap="innerHTML"
              hx-target="#upload-button"
              className="flex flex-col"
              // hx-trigger="click target:#upload-button"
              hx-disinherit="hx-target"
              // @ts-ignore
              _="on htmx:xhr:progress(loaded, total) 
              if (loaded/total)*100 != Infinity
                set #progress.value to (loaded/total)*100
              console.log((loaded/total)*100)
            "
            >
              <select
                className="select w-full max-w-xs"
                name="base_model"
                placeholder="base_model"
                defaultValue="chilloutmix-Ni-pruned-fp32.safetensors"
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
                type="text"
                className="input input-bordered w-full max-w-xs"
                name="name"
                placeholder="Name"
                defaultValue="benny"
              />
              <input
                type="text"
                className="input input-bordered w-full max-w-xs"
                name="sample_prompt"
                placeholder="sample_prompt"
                defaultValue="masterpiece, best quality, 1girl, upper body, looking at viewer, simple background --n low quality, worst quality, bad anatomy, bad composition, poor, low effort --w 512 --h 512 --d 1 --l 8 --s 30"
              />
              <input
                type="text"
                className="input input-bordered w-full max-w-xs"
                name="instance_name"
                placeholder="instance_name"
                defaultValue="benny123"
              />
              <input
                type="text"
                className="input input-bordered w-full max-w-xs"
                name="class_name"
                placeholder="class_name"
                defaultValue="man"
              />
              <input
                type="number"
                className="input input-bordered w-full max-w-xs"
                name="repeat_step"
                placeholder="40"
                defaultValue="40"
              />
              <input
                type="file"
                className="file-input w-full max-w-xs"
                id="files"
                name="files"
                multiple
              />
              <div className="w-full flex">
                <button id="upload-button" type="submit" className="btn grow" >Submit</button>
                <StartButton />
              </div>
              <progress
                id="progress"
                className="w-full progress"
                value="0"
                max="100"
              ></progress>
            </form>
          </div>
          <div className="overflow-y-auto w-full">
            <div id="run-container" className="flex flex-col-reverse grow justify-end h-fit " />
          </div>
        </div>
      </body>
    </html >
  );
}

function StartButton({ text = "Start" }: { text?: React.ReactNode }) {
  return (
    <button
      type="button"
      // id="start-btn"
      className="btn"
      hx-post="./start"
      hx-swap="outerHTML"
    >
      {text}
    </button>
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


function startLoraTraining(folderPaths: FolderPaths) {
  const modelPath = modelFolders + folderPaths.base_model;
  const dataDir = join(dirname(__dirname), folderPaths.img_root); //"/home/avatech/Desktop/projects/kohya_ss/dataset/img";
  const outputDir = join(dirname(__dirname), folderPaths.model); //"/home/avatech/Desktop/projects/kohya_ss/dataset/model";
  const loggingDir = join(dirname(__dirname), folderPaths.log);
  const modelName = folderPaths.modelName;
  const samplePromptPath = join(dirname(__dirname), folderPaths.sample_prompt); //"/home/avatech/Desktop/projects/kohya_ss/dataset/model/sample/prompt.txt";
  const scripPath = "./../train_db.py";
  const command = `source \"./../venv/bin/activate\" && CUDA_VISIBLE_DEVICES=1 accelerate launch --num_cpu_threads_per_process=2 "${scripPath}" --enable_bucket --min_bucket_reso=256 --max_bucket_reso=2048 --pretrained_model_name_or_path="${modelPath}" --train_data_dir="${dataDir}" --resolution="512,512" --output_dir="${outputDir}" --logging_dir="${loggingDir}" --save_model_as=safetensors --output_name="${modelName}" --lr_scheduler_num_cycles="1" --max_data_loader_n_workers="0" --learning_rate="0.0001" --lr_scheduler="cosine" --lr_warmup_steps="595" --train_batch_size="2" --max_train_steps="5950" --save_every_n_epochs="1" --mixed_precision="fp16" --save_precision="fp16" --seed="7" --caption_extension=".txt" --cache_latents --optimizer_type="AdamW" --max_data_loader_n_workers="0" --clip_skip=2 --bucket_reso_steps=64 --flip_aug --xformers --bucket_no_upscale --noise_offset=0.0 --sample_sampler=euler_a --sample_prompts="${samplePromptPath}" --sample_every_n_steps="128"`;

  console.log(command);
  globalThis.runCount++;

  if (debug)
    return command

  let cmdarray = command.split(" ");
  globalThis.loraProc = spawn(cmdarray.shift()!, cmdarray, {
    stdio: "inherit",
    shell: true,
    detached: true,
  });

  return command;
}


async function Comp(children: React.ReactNode) {
  return new Response(await renderToReadableStream(children), {
    headers: { "Content-Type": "text/html" },
  });
}

function CompToString(children: ReactElement) {
  return renderToString(children);
}

type WebSocketData = {
  // id: string;
  folderName: string;
  runId: string;
};

Bun.serve<WebSocketData>({
  websocket: {
    async open(ws) {
      console.log(ws.data);

      const folder = `data/${ws.data.folderName}/model/sample`;
      console.log("connected + " + ws.data.runId, folder);

      const watcher = chokidar.watch(folder, {
        ignored: /^\./,
        persistent: true,
      });

      watcher.on("add", async (filepath) => {
        console.log("add ", filepath, extname(filepath));

        if (extname(filepath) === ".jpg" || extname(filepath) === ".jpeg" || extname(filepath) === ".png") {
          // // delay to wait for file to be written
          await new Promise((resolve) => setTimeout(resolve, 1000));

          ws.send(`
            <div id="image-container-${ws.data.runId}" hx-swap-oob="beforeend" >
            <img src="./image/${encodeURI(filepath)}"/>
            </div>
          `)
        }
      });

      globalThis.allClients[ws.data.runId] = {
        ws,
        runId: ws.data.runId,
        watcher,
      };
    },
    async close(ws) {
      await globalThis.allClients[ws.data.runId].watcher?.close();
      console.log("Removing", globalThis.allClients[ws.data.runId].runId);
      delete globalThis.allClients[ws.data.runId];
    },
    message(ws, message) { },
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    const params = url.searchParams;

    if (url.pathname === "/ws") {
      // const sessionId = await generateSessionId();

      // console.log("hello", url, params.get("folder"), url.searchParams.toString());

      server.upgrade(req, {
        // headers: {
        //   "Set-Cookie": `SessionId=${sessionId}`,
        // },
        data: {
          // id: runId,
          folderName: params.get("folder")!,
          runId: params.get("runId")!,
        } as WebSocketData,
      });
    }

    // return index.html for root path
    if (url.pathname === "/") {
      return Comp(<Component message="Hello from server!" />);
    }

    console.log(url.pathname);

    if (url.pathname === "/index.css") {
      return new Response(Bun.file("output.css"), {
        headers: {
          "Content-Type": "text/css",
        },
      });
    }

    // parse formdata at /action
    if (url.pathname === "/action") {
      const formdata = await req.formData();
      const name = formdata.get("name") as string;
      const base_model = formdata.get("base_model") as string;
      const class_name = formdata.get("class_name") as string;
      const instance_name = formdata.get("instance_name") as string;
      const sample_prompt = formdata.get("sample_prompt") as string;
      const repeat_step = Number.parseInt(
        formdata.get("repeat_step") as string
      );

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
        })
      );

      globalThis.folderPaths = {
        modelName: name,
        base_model: base_model,
        sample_prompt: `data/${name}/prompt.txt`,
        ...temp,
      };

      await Bun.write(globalThis.folderPaths.sample_prompt, sample_prompt);

      const filesOps: Promise<unknown>[] = [];
      formdata.getAll("files").forEach((x, i) => {
        let fileType = (x as Blob).type.replace("image/", ".");
        if (fileType == ".jpeg") fileType = ".jpg";

        let filePath = globalThis.folderPaths?.img + "/image_" + i + fileType;
        // console.log(filePath);

        filesOps.push(Bun.write(filePath, x));
      });
      await Promise.allSettled(filesOps);
      await startCaptioning(globalThis.folderPaths);

      return Comp(<div>Submit <div className="text-green-600 text-sm normal-case">Success</div></div>);
    }

    if (url.pathname.startsWith("/image")) {
      let file = url.pathname.replace("/image/", "")
      console.log(file);

      // exists(file, (exists) => {
      //   console.log(exists);
      // })

      return new Response(Bun.file(decodeURI(file)))
    }

    if (url.pathname === "/start") {
      const folderPaths = globalThis.folderPaths;
      if (folderPaths) {
        const command = startLoraTraining(folderPaths);
        const code = shiki.codeToHtml(command, { lang: 'bash', theme: 'nord' })
        const runId = generateSessionId();

        return Comp(
          <>
            <button
              // id="stop-btn"
              className="btn"
              hx-post={"./stop?runId=" + runId}
              // hx-swap-oob="false"
              hx-swap="outerHTML"
            >
              Stop
            </button>

            <div id="run-container" hx-swap-oob="beforeend">
              <div className=" border border-base-300 visible"  >
                <input type="checkbox" className="w-full h-20 appearance-none absolute cursor-pointer" hx-on:click="['!flex', '!opacity-100'].map(v=> this.nextElementSibling.nextElementSibling.classList.toggle(v) ) "/>
                <div className="collapse-title text-xl font-medium !flex !opacity-100 justify-between pointer-events-none">
                  <span>Run #{globalThis.runCount} <span className="text-sm text-gray-500">{runId}</span></span>
                  <span id={`status-${runId}`} className="text-sm">Running...</span>
                </div>
                <div className="hidden !min-h-fit flex-col items-start opacity-0 transition-all">
                  <div>
                    <p dangerouslySetInnerHTML={{
                      __html: code
                    }}></p>
                  </div>
                  <div
                    hx-ext="ws"
                    ws-connect={`/ws?runId=${runId}&folder=${folderPaths.modelName}`}
                  >
                    <div id={`image-container-${runId}`} className="grid grid-cols-3"></div>
                  </div>
                </div>
              </div>
            </div>
          </>
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
          />
        );
      }
    }

    if (url.pathname === "/stop") {
      let runId = params.get("runId")
      // <span id={`${runId}-status`} className="text-sm">Running...</span>

      globalThis.allClients[runId!].ws.send(
        CompToString(
          <span id={`status-${runId}`} className="text-sm text-red-700" hx-swap-oob="true" > Stopped</span >
        )
      )

      globalThis.allClients[runId!].ws.close(1000)

      if (globalThis.loraProc && !globalThis.loraProc.killed) {
        // loraProc.kill('SIGINT');
        // process.kill(loraProc.pid! + 1, 'SIGINT')
        spawn("sh", ["-c", "kill -INT -" + globalThis.loraProc.pid]);
        loraProc = undefined;
        // await loraProc.;
        return Comp(<StartButton />);
      }
      return Comp(<StartButton />);
    }

    return new Response("Not Found", { status: 404 });
  },
});

function generateSessionId() {
  return uuidv4();
}
