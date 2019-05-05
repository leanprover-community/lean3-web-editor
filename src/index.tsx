/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, loadBufferFromURLCached, Message, WebWorkerTransport } from 'lean-client-js-browser';
import * as React from 'react';
import { findDOMNode, render } from 'react-dom';
import * as sp from 'react-split-pane';
import { allMessages, currentlyRunning, delayMs, registerLeanLanguage, server } from './langservice';
export const SplitPane: any = sp;

function leanColorize(text: string): string {
  // TODO(gabriel): use promises
  const colorized: string = (monaco.editor.colorize(text, 'lean', {}) as any)._value;
  return colorized.replace(/&nbsp;/g, ' ');
}

interface MessageWidgetProps {
  msg: Message;
}
function MessageWidget({msg}: MessageWidgetProps) {
  const colorOfSeverity = {
    information: 'green',
    warning: 'orange',
    error: 'red',
  };
  // TODO: links and decorations on hover
  return (
    <div style={{paddingBottom: '1em'}}>
      <div className='info-header' style={{ color: colorOfSeverity[msg.severity] }}>
        {msg.pos_line}:{msg.pos_col}: {msg.severity}: {msg.caption}</div>
      <div className='code-block' dangerouslySetInnerHTML={{__html: leanColorize(msg.text)}}/>
    </div>
  );
}

interface Position {
  line: number;
  column: number;
}

interface GoalWidgetProps {
  goal: InfoRecord;
  position: Position;
}
function GoalWidget({goal, position}: GoalWidgetProps) {
  const tacticHeader = goal.text && <div className='info-header'>
    tactic {<span style={{fontWeight: 'normal'}}> {goal.text} </span>}
    at {position.line}:{position.column}</div>;
  const docs = goal.doc && <ToggleDoc doc={goal.doc}/>;

  const typeHeader = goal.type && <div className='info-header'>
    type {goal['full-id'] && <span> of <span style={{fontWeight: 'normal'}}>
      {goal['full-id']}</span> </span>}
    at {position.line}:{position.column}</div>;
  const typeBody = (goal.type && !goal.text) // don't show type of tactics
    && <div className='code-block'
    dangerouslySetInnerHTML={{__html: leanColorize(goal.type) + (!goal.doc && '<br />')}}/>;

  const goalStateHeader = goal.state && <div className='info-header'>
    goal at {position.line}:{position.column}</div>;
  const goalStateBody = goal.state && <div className='code-block'
    dangerouslySetInnerHTML={{__html: leanColorize(goal.state)}}/>;

  return (
    <div style={{paddingBottom: '1em'}}>
    {tacticHeader || typeHeader}
    {typeBody}
    {docs}
    {goalStateHeader}
    {goalStateBody}
    </div>
  );
}

interface ToggleDocProps {
  doc: string;
}
interface ToggleDocState {
  showDoc: boolean;
}
class ToggleDoc extends React.Component<ToggleDocProps, ToggleDocState> {
  constructor(props: ToggleDocProps) {
    super(props);
    this.state = { showDoc: this.props.doc.length < 80 };
    this.onClick = this.onClick.bind(this);
  }
  onClick() {
    this.setState({ showDoc: !this.state.showDoc });
  }
  render() {
    return <div onClick={this.onClick} className='toggleDoc'>
      {this.state.showDoc ?
        this.props.doc : // TODO: markdown / highlighting?
        <span>{this.props.doc.slice(0, 75)} <span style={{color: '#246'}}>[...]</span></span>}
      <br/><br/>
    </div>;
  }
}

interface InfoViewProps {
  file: string;
  cursor?: Position;
}
interface InfoViewState {
  goal?: GoalWidgetProps;
  messages: Message[];
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: InfoViewProps) {
    super(props);
    this.state = { messages: [] };
  }
  componentWillMount() {
    this.updateMessages(this.props);
    this.subscriptions.push(
      server.allMessages.on((allMsgs) => this.updateMessages(this.props)),
    );
  }
  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }
  componentWillReceiveProps(nextProps) {
    if (nextProps.cursor === this.props.cursor) { return; }
    this.updateMessages(nextProps);
    this.refreshGoal(nextProps);
  }

  updateMessages(nextProps) {
    this.setState({
      messages: allMessages.filter((v) => v.file_name === this.props.file),
    });
  }

  refreshGoal(nextProps?: InfoViewProps) {
    if (!nextProps) {
      nextProps = this.props;
    }
    if (!nextProps.cursor) {
      return;
    }

    const position = nextProps.cursor;
    server.info(nextProps.file, position.line, position.column).then((res) => {
      this.setState({goal: res.record && { goal: res.record, position }});
    });
  }

  render() {
    const goal = this.state.goal && (<div key={'goal'}>{GoalWidget(this.state.goal)}</div>);
    const msgs = this.state.messages.map((msg, i) =>
      (<div key={i}>{MessageWidget({msg})}</div>));
    return (
      <div style={{overflow: 'auto', height: '100%'}}>
        {goal}
        {msgs}
      </div>
    );
  }
}

interface PageHeaderProps {
  file: string;
  url: string;
  onSubmit: (value: string) => void;
  status: string;
  onSave: () => void;
  onLoad: (localFile: string) => void;
  clearUrlParam: () => void;
  onChecked: () => void;
}
interface PageHeaderState {
  currentlyRunning: boolean;
}
class PageHeader extends React.Component<PageHeaderProps, PageHeaderState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: PageHeaderProps) {
    super(props);
    this.state = { currentlyRunning: true };
    this.onFile = this.onFile.bind(this);
    // this.restart = this.restart.bind(this);
    this.mount = this.mount.bind(this);
  }

  componentWillMount() {
    this.updateRunning(this.props);
    this.subscriptions.push(
      currentlyRunning.updated.on((fns) => this.updateRunning(this.props)),
    );
  }
  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }
  componentWillReceiveProps(nextProps) {
    this.updateRunning(nextProps);
  }

  updateRunning(nextProps) {
    this.setState({
      currentlyRunning: currentlyRunning.value.indexOf(nextProps.file) !== -1,
    });
  }

  onFile(e) {
    const reader = new FileReader();
    const file = e.target.files[0];
    reader.readAsText(file);
    reader.onload = () => this.props.onLoad(reader.result as string);
    this.props.clearUrlParam();
  }

  // This doesn't work! /test.lean not found after restarting
  // restart() {
  //   // server.restart();
  //   registerLeanLanguage(leanJsOpts);
  // }

  mount() {
    if (!server) { return; }
    const conn = (server.transport as WebWorkerTransport).conn;
    conn.send({ command: 'load-zip', url: './mathlib.zip' });
    // const t = server.transport; // as InProcessTransport;
    // const zipPromise = loadBufferFromURLCached('./mathlib.zip');
    // t.loadZip(zipPromise).then((success) => console.log('zip loaded?', success));
  }

  render() {
    const isRunning = this.state.currentlyRunning ? 'running...' : 'ready!';
    const runColor = this.state.currentlyRunning ? 'orange' : 'lightgreen';
    // TODO: add input for delayMs
    // checkbox for console spam
    // server.logMessagesToConsole = true;
    return (
      <div className='wrap-collapsible'>
        <input id='collapsible' className='toggle' type='checkbox' defaultChecked={true}
        onChange={this.props.onChecked}/>
        <label style={{background: runColor}} htmlFor='collapsible' className='lbl-toggle' tabIndex={0}>
            Lean is {isRunning}
        </label>
        <div className='collapsible-content'><div className='leanheader'>
          <img className='logo' src='./lean_logo.svg'
          style={{height: '5em', margin: '1ex', paddingLeft: '1em', paddingRight: '1em'}}/>
          <div className='headerForms'>
            <UrlForm url={this.props.url} onSubmit={this.props.onSubmit}
            clearUrlParam={this.props.clearUrlParam}/>
            <div style={{float: 'right', margin: '1em'}}>
              <button onClick={this.props.onSave}>Save</button>
              {/* <button onClick={this.restart}>Restart server:<br/>will redownload<br/>library.zip!</button> */}
              {<button onClick={this.mount}>mount</button>}
            </div>
            <label className='logo' htmlFor='lean_upload'>Load .lean from disk:&nbsp;</label>
            <input id='lean_upload' type='file' accept='.lean' onChange={this.onFile}/>
            <div className='leanlink'>
              <span className='logo'>Live in-browser version of the </span>
              <a href='https://leanprover.github.io/'>Lean
                <span className='logo'> theorem prover</span>
              </a>
              <span className='running'> on the go!</span>
              <span className='logo'>.</span>
            </div>
            {this.props.status}
          </div>
        </div></div>
      </div>
    );
  }
}

interface UrlFormProps {
  url: string;
  onSubmit: (value: string) => void;
  clearUrlParam: () => void;
}
interface UrlFormState {
  value: string;
}
class UrlForm extends React.Component<UrlFormProps, UrlFormState> {
  constructor(props) {
    super(props);
    this.state = {value: this.props.url};

    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleChange(event) {
    this.setState({value: event.target.value});
    this.props.clearUrlParam();
  }

  handleSubmit(event) {
    this.props.onSubmit(this.state.value);
    event.preventDefault();
  }

  render() {
    return (
      <div className='urlForm'>
      <form onSubmit={this.handleSubmit}>
        <span className='url'>Load .lean from&nbsp;</span>
        URL:&nbsp;<input type='text' value={this.state.value} onChange={this.handleChange}/>
        <input type='submit' value='Load' />
      </form></div>
    );
  }
}

interface LeanEditorProps {
  file: string;
  initialValue: string;
  onValueChange?: (value: string) => void;
  initialUrl: string;
  onUrlChange?: (value: string) => void;
  clearUrlParam: () => void;
}
interface LeanEditorState {
  cursor?: Position;
  split: 'vertical' | 'horizontal';
  url: string;
  status: string;
  size: number;
  checked: boolean;
}
class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
  model: monaco.editor.IModel;
  editor: monaco.editor.IStandaloneCodeEditor;

  constructor(props: LeanEditorProps) {
    super(props);
    this.state = {
      split: 'vertical',
      url: this.props.initialUrl,
      status: null,
      size: null,
      checked: true,
    };
    this.model = monaco.editor.createModel(this.props.initialValue, 'lean', monaco.Uri.file(this.props.file));
    this.model.onDidChangeContent((e) =>
      this.props.onValueChange &&
      this.props.onValueChange(this.model.getValue()));

    this.updateDimensions = this.updateDimensions.bind(this);
    this.dragFinished = this.dragFinished.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.onSave = this.onSave.bind(this);
    this.onLoad = this.onLoad.bind(this);
    this.onChecked = this.onChecked.bind(this);
  }
  componentDidMount() {
    const node = findDOMNode(this.refs.monaco) as HTMLElement;
    const options: monaco.editor.IEditorConstructionOptions = {
      selectOnLineNumbers: true,
      roundedSelection: false,
      readOnly: false,
      theme: 'vs',
      cursorStyle: 'line',
      automaticLayout: true,
      cursorBlinking: 'solid',
      model: this.model,
      minimap: {enabled: false},
      wordWrap: 'on',
      scrollBeyondLastLine: false,
    };
    this.editor = monaco.editor.create(node, options);
    this.editor.onDidChangeCursorPosition((e) =>
      this.setState({cursor: {line: e.position.lineNumber, column: e.position.column - 1}}));

    this.determineSplit();
    window.addEventListener('resize', this.updateDimensions);
  }
  componentWillUnmount() {
    this.editor.dispose();
    this.editor = undefined;
    window.removeEventListener('resize', this.updateDimensions);
  }
  componentDidUpdate() {
    // if state url is not null, fetch, then set state url to null again
    if (this.state.url) {
      try {
        fetch(this.state.url).then((s) => s.text())
          .then((s) => {
            this.model.setValue(s);
            this.setState({ status: null });
          });
      } catch (e) {
        // won't show CORS errors, also 404's etc. don't qualify as errors
        this.setState({ status: e.toString() });
      }
      this.setState({ url: null });
    }
  }

  updateDimensions() {
    this.determineSplit();
  }
  determineSplit() {
    const node = findDOMNode(this.refs.root) as HTMLElement;
    this.setState({split: node.clientHeight > 0.8 * node.clientWidth ? 'horizontal' : 'vertical'});
    // can we reset the pane "size" when split changes?
  }
  dragFinished(newSize) {
    this.setState({ size: newSize });
  }

  onSubmit(value) {
    this.props.onUrlChange(value);
    this.setState({ url: value });
  }

  onSave() {
    const file = new Blob([this.model.getValue()], { type: 'text/plain' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(file);
    a.href = url;
    a.download = this.props.file;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 0);
  }
  onLoad(fileStr) {
    this.model.setValue(fileStr);
    this.props.clearUrlParam();
  }

  onChecked() {
    this.setState({ checked: !this.state.checked });
  }

  render() {
    const infoStyle = {
      height: (this.state.size && (this.state.split === 'horizontal')) ?
        `calc(95vh - ${this.state.checked ? 115 : 0}px - ${this.state.size}px)` :
        (this.state.split === 'horizontal' ?
        // crude hack to set initial height if horizontal
          `calc(35vh - ${this.state.checked ? 45 : 0}px)` :
          '100%'),
      width: (this.state.size && (this.state.split === 'vertical')) ?
        `calc(98vw - ${this.state.size}px)` :
        (this.state.split === 'vertical' ? '38vw' : '99%'),
      };
    return (<div className='leaneditorContainer'>
      <div className='headerContainer'>
        <PageHeader file={this.props.file} url={this.props.initialUrl}
        onSubmit={this.onSubmit} clearUrlParam={this.props.clearUrlParam} status={this.state.status}
        onSave={this.onSave} onLoad={this.onLoad} onChecked={this.onChecked}/>
      </div>
      <div className='editorContainer' ref='root'>
        <SplitPane split={this.state.split} defaultSize='60%' allowResize={true}
        onDragFinished={this.dragFinished}>
          <div ref='monaco' className='monacoContainer'/>
          <div className='infoContainer' style={infoStyle}>
            <InfoView file={this.props.file} cursor={this.state.cursor}/>
          </div>
        </SplitPane>
      </div>
    </div>);
  }
}

const defaultValue =
  '-- Live javascript version of Lean\n\nexample (m n : ℕ) : m + n = n + m :=\nby simp';

function App() {
  const initUrl: URL = new URL(window.location.href);
  const params: URLSearchParams = initUrl.searchParams;
  // get target key/value from URLSearchParams object
  const url: string = params.has('url') ? decodeURI(params.get('url')) : '';
  const value: string = params.has('code') ? decodeURI(params.get('code')) :
    (url ? `-- loading from ${url}` : defaultValue);

  function changeUrl(newValue, key) {
    params.set(key, encodeURI(newValue));
    history.replaceState(undefined, undefined, '?' + params.toString());
  }

  function clearUrlParam() {
    params.delete('url');
    history.replaceState(undefined, undefined, '?' + params.toString());
  }

  const fn = monaco.Uri.file('test.lean').fsPath;
  return (
    <LeanEditor file={fn} initialValue={value} onValueChange={(newValue) => changeUrl(newValue, 'code')}
    initialUrl={url} onUrlChange={(newValue) => changeUrl(newValue, 'url')}
    clearUrlParam={clearUrlParam} />
  );
}

const leanJsOpts: LeanJsOpts = {
  javascript: './lean_js_js.js',
  libraryZip: './library.zip',
  webassemblyJs: './lean_js_wasm.js',
  webassemblyWasm: './lean_js_wasm.wasm',
};

// tslint:disable-next-line:no-var-requires
(window as any).require(['vs/editor/editor.main'], () => {
  registerLeanLanguage(leanJsOpts);
  render(
    <App />,
    document.getElementById('root'),
  );
});
