class ChunkCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = Math.round(sampleRate * (options.processorOptions?.seconds || 8));
    this.buffer = new Float32Array(this.size); this.used = 0; this.total = 0;
    this.port.onmessage = e => {
      if (e.data === 'flush') { this.send(); this.port.postMessage({ flushed:true }); }
    };
  }
  send() {
    if (!this.used) return;
    const pcm = new Int16Array(this.used); let square = 0;
    for (let i=0;i<this.used;i++) {
      const v = Math.max(-1,Math.min(1,this.buffer[i])); square += v*v;
      pcm[i] = Math.round(v * (v<0 ? 32768:32767));
    }
    this.port.postMessage({ pcm:pcm.buffer,rms:Math.sqrt(square/this.used),offset:this.total/sampleRate },[pcm.buffer]);
    this.total += this.used; this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0]; if (!channels?.length) return true;
    const count = channels[0].length;
    for(let i=0;i<count;i++) {
      let value=0; for(const c of channels) value+=c[i];
      this.buffer[this.used++] = value/channels.length;
      if(this.used===this.size) this.send();
    }
    return true;
  }
}
registerProcessor('chunk-capture',ChunkCapture);
