// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Help browser - search aliases                       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// The words people TYPE, which are often not the words the help is written in.
// Somebody who wants a bigger image searches "upscale" or "make it bigger", not
// "resize modes", and without this they get nothing and give up.
//
// These live here rather than inside each help def on purpose: a help def is
// about explaining a node to a reader, and stuffing search bait into its prose
// would make it worse to read. Nothing here is ever displayed - it only feeds
// the search index.
//
// A help def may ALSO carry its own `keywords` string; the two are merged, so a
// node that keeps its aliases next to its own code still works.
//
// To add a node: one line, keyed by its exact comfyClass. Missing entries are
// fine - the node is still found by its name, tagline and full help text.

export const KEYWORDS = {
  "canvas:workflows": "workflow manager browse organise organize my workflows folder rename move file explorer thumbnail cover picture star favourite favorite duplicate junk tidy messy find lost which workflow used broken image missing picture video mp4 card blank grey map",
  // ── Resize and crop: the biggest source of missed searches ──
  PixaromaImageResize: "upscale enlarge bigger smaller shrink scale megapixel resolution downscale make it bigger",
  PixaromaLongestSide: "longest side long edge longest edge biggest side largest side resize simple small resize quick resize downscale shrink smaller bigger make it 864 1024 1216 1536 2048 832 scale to size crop to square crop to ratio centre crop center crop crop to 16:9 9:16 2:3 phone shape aspect shape chips tall wide sdxl size multiple of 8 16 32 64 round size one number resize without width height",
  PixaromaResizeCrop: "exact size cover fill stretch squash aspect force size",
  PixaromaCrop: "trim cut region area chop",
  PixaromaUncrop: "paste back restore put back region",
  PixaromaInpaintCrop: "inpaint mask repair fix retouch face hands blemish",
  PixaromaInpaintStitch: "seam blend feather merge join invisible edge",
  PixaromaOutpaint: "extend expand wider taller border pad zoom out uncrop background",
  PixaromaOutpaintStitch: "restore original seam blend outpaint",

  // ── Image ──
  PixaromaLoadImage: "open file input picker photo import",
  PixaromaLoadImageMini: "small compact loader tidy",
  PixaromaImageInfo: "width height mask filename size dimensions",
  PixaromaLoadImagesFolder: "batch folder directory many bulk each one by one subfolders recursive keep structure tree mirror flatten",
  PixaromaPreview: "view result thumbnail show display civitai metadata parameters resources share",
  PixaromaSaveImage: "export write disk output filename png jpg jpeg webp lossless quality compression file size smaller folder subfolders tree mirror civitai metadata parameters resources share lora hash embed settings gear hide buttons",
  PixaromaCompare: "before after slider difference ab side by side",
  PixaromaRemoveBackground: "cutout transparent alpha matte birefnet rembg erase background",
  PixaromaLoadVideo: "mp4 movie frames clip import video",
  PixaromaLoadVideoFrame: "still grab frame single picture screenshot",
  PixaromaFirstLastFrame: "first last frame start end continue continuation extend chain join carry on next video ending beginning still grab last frame from video",
  PixaromaSaveMp4: "export video render encode movie mp4 h264 audio fade click tick pop start onset",
  PixaromaSaveVideo: "export video render encode movie mp4 h264 h265 hevc 10 bit 10bit ten bit colour color depth banding gradient smooth quality crf bitrate folder subfolders filename tokens counter name fps duration frames seconds length trim audio soundtrack player preview scrub settings gear hide buttons master grade edit audio fade click tick pop start onset",
  PixaromaSaveText: "save text txt export write disk file collect collection gather accumulate keep store log history journal notebook remember lost losing prompts prompt list library archive append add each run every run batch llm generated prompts edit copy clear folder filename counter separator blank line timestamp reuse later",
  PixaromaPauseImage: "stop check gate review approve interrupt",

  // ── Prompt and text ──
  PixaromaPrompt: "tag library wildcard random autocomplete snippet phrase reorder order sort rearrange move category colour color highlight underline resize sidebar rename",
  PixaromaPromptMulti: "batch queue many list prompts",
  PixaromaPromptEach: "list batch bulk many multiple prompts one per line each every all at once single run output_is_list brackets combinations variations expand queue several",
  PixaromaPromptPack: "batch paste queue block many prompts separator split blank line new line dashes --- paragraph reuse rerun run again txt file import load collected save text",
  PixaromaPromptStack: "assemble parts toggle build pieces chunks",
  PixaromaPromptFromList: "index pick number choose",
  PixaromaFindReplace: "replace swap substitute rules change words",
  PixaromaText: "string write field type note textbox",
  PixaromaShowText: "debug display print inspect see value preview text",
  PixaromaPromptReader: "metadata png extract read recover steal prompt from image exif",
  PixaromaPauseText: "llm edit review gate check interrupt cache cached runs again re-runs ksampler restarts fixed seed slow",
  PixaromaTextJoinTwo: "concat combine merge glue join",
  PixaromaTextJoinThree: "concat combine merge glue join",
  PixaromaTextJoinFour: "concat combine merge glue join",

  // ── Notes and overlay ──
  PixaromaNote: "comment sticky documentation annotate",
  PixaromaLabel: "caption title heading name explain",
  PixaromaTextOverlay: "caption title font subtitle words on image ttf otf typeface custom font own font install font fonts folder",
  PixaromaTextWatermark: "signature logo copyright brand stamp font ttf otf typeface custom font own font install font fonts folder",

  // ── Values ──
  PixaromaResolution: "size width height ratio dimensions aspect",
  PixaromaSizes: "preset list dimensions size resolution star starred recommended favourite favorite mark best supported",
  PixaromaSliders: "slider knob dashboard remote control panel",
  PixaromaSeed: "random fixed number sampler noise",
  PixaromaNumber: "int float value amount",
  PixaromaDuration: "duration seconds length how long video length frames frame count fps frame rate clip length 5 seconds 10 seconds convert seconds to frames how many frames minimax h3 wan hunyuan ltx 4n+1 8n+1 17n+5 multiple of 4 plus 1 length must be math expression formula video too short video too long sampler rejected frame count",
  // ── Sound ──
  PixaromaLoadAudio: "audio sound music song track wav mp3 flac ogg m4a load audio open audio import audio waveform wave shape see the sound trim cut clip chop shorten crop audio start at start time offset pick the chorus drag select selection window play preview listen upload voice speech dialogue voiceover narration soundtrack backing track how long silence pad loop repeat",
  PixaromaH3AudioSync: "h3 minimax minimax h3 lipsync lip sync lip-sync mouth singing sing song music video native audio audio lock lock the audio exact audio real audio my own audio use my song talking head speech dialogue av latent joint latent freeze audio noise mask 15 seconds too long clip length audio does not match video sound out of sync drift silent gibberish mumbling made up audio",
  PixaromaDropdown: "dropdown drop down list options preset choose pick select menu combo trigger word lora trigger shortcut saved values my own list named values swap between combination pair two values several outputs sampler scheduler sampler and scheduler width and height steps and cfg set both at once linked values",
  PixaromaAIPrompt: "preset presets example formula load formula save formula recipe krea krea2 krea 2 turbo text to image expand my prompt prompt enhancer enhance temperature too high echoes my formula ignores instructions ai llm local llm language model chatgpt offline no api key no account qwen qwen3 vl vision model caption captioning describe this image alt text rewrite reword rephrase change the style improve my prompt prompt writer prompt generator prompt helper make it better shorter longer summarise summarize translate transcribe mood of the music audio to text video to text formula instruction system prompt chain chained several in a row one after another step by step passthrough pass through no model does nothing text in text out generate text textgen sampling temperature top k top p seed free vram unload model loads twice duplicate copy the formula where are my presets saved presets folder back up my presets share a preset send someone a preset does everyone get the krea formula filter presets search presets too many presets find a preset which presets are mine which came with the node my own presets orange dot grey dot image to prompt prompt from an image describe a picture make a similar image copy the style of an image reverse prompt what prompt made this tag tags @tag tag library snippet wildcard random slot #list list category autocomplete highlight colour color underline typo expand expanded show what the tags expand to reuse a phrase saved phrases shared library same tags as prompt pixaroma",
  PixaromaMusicPrompt: "music song lyrics caption minimax minimax music music 3 minimax music 3 write me a song songwriter song writer make a song text to music write lyrics write a caption verse verses chorus choruses bridge instrumental intro outro solo section tags how long is the song song length duration seconds max duration cut off ends early too short too long ceiling 360 seconds two outputs caption and lyrics two strings one idea both boxes llm local llm qwen qwen3.5 language model offline no api key genre bpm tempo key scale male voice female voice vocals harmonies arrangement instruments seed re-roll free vram unload model auto verses how many verses it ignores my verses gave me two verses passthrough pass through no model does nothing backing vocals backup vocals harmony doubled vocals ad libs round brackets parentheses square brackets suno style tags does not rhyme doesnt rhyme no rhyme make it rhyme rhyming lyrics stage directions describe the instruments in the lyrics instrumental only no vocals no singing no voice background music bgm score soundtrack karaoke just music without words voice or instrumental switch faster one pass tag tags @tag tag library tags library snippet category autocomplete reuse a phrase saved phrases wildcard wildcards random slot rolls a different one each run #list random line highlight colour color red underline what model was this measured on preset changed my model",
  PixaromaVideoPrompt: "h3 minimax minimax h3 prompt writer write my prompt video prompt llm local llm qwen qwen3 vl vision model text to video first frame last frame fflf first and last frame image to video prompt generator prompt helper describe the picture soundscape dialogue talking speech what do i type stop copy pasting from chatgpt formula length 5 seconds 8 seconds 10 seconds 15 seconds text box too small cannot edit my idea make the box bigger expand full screen resize the idea box drag the bar",
  PixaromaWH: "width height size dimensions",
  PixaromaPortraitLandscape: "rotate orientation flip tall wide multiple of 8 16 32 64 round size snap size divisible by step size must be multiple resolution not accepted size error round to nearest",

  // ── Logic and flow ──
  PixaromaSwitch: "route select choose pick multiplexer",
  PixaromaSwitchWH: "ab toggle size swap",
  PixaromaSwitchSource: "ab bank preset swap variant",
  PixaromaMuteSwitch: "bypass disable enable branch off skip",
  PixaromaGroupSwitch: "group bypass mute enable disable",
  PixaromaSetNode: "variable wireless reroute link tidy no wires",
  PixaromaGetNode: "variable wireless reroute link tidy no wires",
  PixaromaLoopStart: "repeat iterate for each again loop",
  PixaromaLoopEnd: "repeat iterate finish end loop",
  PixaromaCombine: "merge batch accumulate gather join",
  PixaromaXYPlot: "grid compare matrix sweep test chart contact sheet lora strength weight side by side versus vs combination example examples which sampler steps cfg",
  PixaromaRunTimer: "time clock how long duration speed stopwatch resize bigger larger size scale font typeface digits mute silent",
  PixaromaRunLog: "history times record log past runs hardware gpu graphics card vram ram memory specs rtx system benchmark",
  PixaromaMonitor: "vram ram memory usage monitor system resources gpu load cpu usage temperature temp hot heat power draw watts performance meter gauge dashboard hud task manager afterburner nvidia smi free vram clear vram unload models out of memory oom how much memory am i using is my card full peak headroom fits will it fit slow overheating fan",
  PixaromaFreeVram: "free vram clear vram empty vram clean vram unload models unload checkpoint release memory out of memory oom cuda out of memory ran out of memory not enough memory low vram torch cache empty cache gc garbage collect purge flush reset memory two models two stages second model wont load model still loaded stuck in memory make room before after in between passthrough trigger vram debug memory manager",
  NotifyPixaroma: "sound alert ding beep finished done chime",
  PixaromaVersionCheck: "version diagnostic about update which version",

  // ── Utility and editors ──
  PixaromaImageResize: "alpha transparency transparent background removed rmbg cutout "
    + "png black background lost preserve keep join image with alpha mask channel rgba",
  PixaromaLoraLoader: "lora stack weight trigger civitai xy plot compare grid sweep "
    + "api key token login account not found missing nsfw adult uncensored mature "
    + "civitai.red unrestricted thumbnail preview blocked hidden "
    + "own picture custom image replace cover photo change thumbnail drag drop paste "
    + "upload set preview no picture blank empty box",
  Pixaroma3D: "mesh glb obj camera light render scene 3d",
  PixaromaPaint: "brush draw sketch layers erase paint",
  PixaromaImageComposition: "collage blend layers grade montage composite text layer font ttf otf custom font",
  PixaromaAudioStudio: "music sound video beat visualizer audio reactive",
};
