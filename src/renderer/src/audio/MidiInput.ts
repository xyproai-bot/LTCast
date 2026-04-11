import { MidiMapping, MidiPort } from '../store'

export type MidiAction =
  | 'play' | 'pause' | 'stop' | 'play-pause'
  | 'next' | 'prev' | 'goto-song'

export interface MidiActionEvent {
  action: MidiAction
  param?: number
}

export interface MidiLearnResult {
  type: 'note-on' | 'control-change' | 'program-change'
  channel: number
  data1: number
}

export class MidiInput {
  private midiAccess: MIDIAccess | null = null
  private selectedInput: MIDIInput | null = null
  private learnCallback: ((result: MidiLearnResult) => void) | null = null
  private isLearning = false

  onActionReceived: ((event: MidiActionEvent) => void) | null = null
  onPortsChanged: (() => void) | null = null
  onMidiActivity: (() => void) | null = null

  async init(existingAccess?: MIDIAccess): Promise<void> {
    if (existingAccess) {
      this.midiAccess = existingAccess
    } else {
      if (!navigator.requestMIDIAccess) throw new Error('Web MIDI API not supported')
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false })
    }
    this.midiAccess.onstatechange = () => {
      this.onPortsChanged?.()
    }
  }

  getInputPorts(): MidiPort[] {
    if (!this.midiAccess) return []
    const ports: MidiPort[] = []
    this.midiAccess.inputs.forEach((inp) => {
      ports.push({ id: inp.id, name: inp.name || inp.id })
    })
    return ports
  }

  selectPort(id: string): boolean {
    if (!this.midiAccess) return false
    // Deselect previous
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null
      this.selectedInput = null
    }
    if (!id) return false
    const inp = this.midiAccess.inputs.get(id)
    if (!inp) return false
    this.selectedInput = inp
    inp.onmidimessage = (e: MIDIMessageEvent) => this.handleMessage(e)
    return true
  }

  deselectPort(): void {
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null
      this.selectedInput = null
    }
  }

  startLearn(callback: (result: MidiLearnResult) => void): void {
    this.isLearning = true
    this.learnCallback = callback
  }

  stopLearn(): void {
    this.isLearning = false
    this.learnCallback = null
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data
    if (!data || data.length < 2) return

    const status = data[0]
    const type = status & 0xF0
    const channel = (status & 0x0F) + 1  // 1-based
    const data1 = data[1]
    const data2 = data.length > 2 ? data[2] : 0

    // MIDI learn: capture first message
    if (this.isLearning && this.learnCallback) {
      let learnType: MidiLearnResult['type'] | null = null
      if (type === 0x90 && data2 > 0) learnType = 'note-on'
      else if (type === 0xB0) learnType = 'control-change'
      else if (type === 0xC0) learnType = 'program-change'
      if (learnType) {
        this.isLearning = false
        const cb = this.learnCallback
        this.learnCallback = null
        cb({ type: learnType, channel, data1 })
        return
      }
    }

    this.onMidiActivity?.()
  }

  processWithMappings(e: MIDIMessageEvent, mappings: MidiMapping[]): void {
    const data = e.data
    if (!data || data.length < 2) return

    const status = data[0]
    const type = status & 0xF0
    const channel = (status & 0x0F) + 1
    const data1 = data[1]
    const data2 = data.length > 2 ? data[2] : 0

    let msgType: MidiMapping['trigger']['type'] | null = null
    if (type === 0x90 && data2 > 0) msgType = 'note-on'
    else if (type === 0xB0) msgType = 'control-change'
    else if (type === 0xC0) msgType = 'program-change'
    if (!msgType) return

    for (const mapping of mappings) {
      const trig = mapping.trigger
      if (trig.type !== msgType) continue
      if (trig.channel !== 0 && trig.channel !== channel) continue
      if (trig.data1 !== data1) continue

      this.onActionReceived?.({ action: mapping.action as MidiAction, param: mapping.actionParam })
      this.onMidiActivity?.()
      break
    }
  }

  setupMappingListener(getMappings: () => MidiMapping[]): void {
    if (!this.selectedInput) return
    this.selectedInput.onmidimessage = (e: MIDIMessageEvent) => {
      if (this.isLearning && this.learnCallback) {
        this.handleMessage(e)
        return
      }
      this.processWithMappings(e, getMappings())
      this.onMidiActivity?.()
    }
  }
}
