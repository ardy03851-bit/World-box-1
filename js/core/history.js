import { emit } from '../bus.js';
import { app } from '../app.js';

export class History {
  constructor(world) {
    this.world = world;
    this.stack = [];
    this.index = -1;
    this.limit = 60;
    this.suspended = false;
    this._timer = null;
    this._pendingLabel = '';
  }

  snapshot() {
    return this.world.serializeProject({ includeCamera: false });
  }

  reset() {
    clearTimeout(this._timer);
    this._timer = null;
    this._pendingLabel = '';
    this.stack = [this.snapshot()];
    this.index = 0;
    this.emitState();
  }

  note(label = 'Edit', delay = 280) {
    if (this.suspended) return;
    this._pendingLabel = label;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.commit(this._pendingLabel || label);
    }, delay);
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
      this.commit(this._pendingLabel || 'Edit');
    }
  }

  commit(label = 'Edit') {
    if (this.suspended) return;
    let snap;
    try {
      snap = this.snapshot();
    } catch (e) {
      console.warn('[history] snapshot failed', e);
      return;
    }
    const json = JSON.stringify(snap);
    const current = this.stack[this.index];
    if (current && JSON.stringify(current) === json) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    this.emitState(label);
    emit('project:changed', { source: 'history' });
  }

  emitState(label = '') {
    emit('history:changed', {
      canUndo: this.index > 0,
      canRedo: this.index < this.stack.length - 1,
      label,
      depth: this.stack.length,
    });
  }

  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  async undo() {
    this.flush();
    if (!this.canUndo) return false;
    this.index--;
    await this.restore();
    return true;
  }

  async redo() {
    this.flush();
    if (!this.canRedo) return false;
    this.index++;
    await this.restore();
    return true;
  }

  async restore() {
    const snap = this.stack[this.index];
    if (!snap) return;
    this.suspended = true;
    const prevSel = app.selection;
    const prevMat = app.selectedMaterial;
    try {
      await this.world.loadProject(JSON.parse(JSON.stringify(snap)), { restoreCamera: false });
      app.project = { ...app.project, ...JSON.parse(JSON.stringify(snap)) };
      if (prevSel && this.world.records.has(prevSel)) {
        this.world.select(prevSel, { materialIndex: prevMat || 0 });
      }
      this.emitState();
    } catch (e) {
      console.error('[history] restore failed', e);
    } finally {
      this.suspended = false;
    }
  }
}
