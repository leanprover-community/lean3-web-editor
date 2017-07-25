/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message, Severity } from 'lean-client-js-browser';
import * as React from 'react';
import { findDOMNode, render } from 'react-dom';
import MonacoEditor from 'react-monaco-editor';
import * as SplitPane from 'react-split-pane';
import {registerLeanLanguage, server} from './langservice';

const codeBlockStyle = {
  display: 'block',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  marginTop: '1em',
  fontSize: '110%',
};

interface MessageWidgetProps {
  msg: Message;
}
function MessageWidget({msg}: MessageWidgetProps) {
  const colorOfSeverity = {
    information: 'green',
    warning: 'orange',
    error: 'red',
  };

  return (
    <div style={{paddingBottom: '1em'}}>
      <div style={{ borderBottom: '1px solid', fontFamily: 'sans-serif',
          fontWeight: 'bold', color: colorOfSeverity[msg.severity] }}>
        {msg.pos_line}:{msg.pos_col}: {msg.severity}: {msg.caption}</div>
      <div style={codeBlockStyle}>{msg.text}</div>
    </div>
  );
}

interface GoalWidgetProps {
  goal: InfoRecord;
  position: monaco.Position;
}
function GoalWidget({goal, position}: GoalWidgetProps) {
  return (
    <div style={{paddingBottom: '1em'}}>
      <div style={{borderBottom: '1px solid', fontWeight: 'bold', fontFamily: 'sans-serif'}}>
        goal at {position.lineNumber}:{position.column - 1}</div>
      <div style={codeBlockStyle}>{goal.state}</div>
    </div>
  );
}

interface InfoViewProps {
  file: string;
  cursor?: monaco.Position;
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
    this.subscriptions.push(
      server.allMessages.on((allMsgs) => {
        this.setState({
          messages: allMsgs.msgs.filter((v) => v.file_name === this.props.file),
        });
        // this.forceUpdate();
      }),
    );
  }

  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }

  render() {
    const goal = this.state.goal && (<div key={'goal'}>{GoalWidget(this.state.goal)}</div>);
    const msgs = this.state.messages.map((msg, i) =>
      (<div key={i}>{MessageWidget({msg})}</div>));
    return (
      <div>
        {goal}
        {msgs}
      </div>
    );
  }

  componentWillReceiveProps(nextProps) {
    this.refreshGoal();
  }

  refreshGoal() {
    if (!this.props.cursor) {
      return;
    }

    const position = this.props.cursor;
    server.info(this.props.file, position.lineNumber, position.column - 1).then((res) => {
      this.setState({goal: res.record && res.record.state && {goal: res.record, position}});
    });
  }
}

interface LeanEditorProps {
  file: string;
  initialValue: string;
  onValueChange?: (value: string) => void;
}
interface LeanEditorState {
  cursor?: monaco.Position;
  split: 'vertical' | 'horizontal';
}
class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
  model: monaco.editor.IModel;
  editor: monaco.editor.IStandaloneCodeEditor;

  constructor(props) {
    super(props);
    this.state = {split: 'vertical'};
    this.model = monaco.editor.createModel(this.props.initialValue, 'lean', monaco.Uri.file(this.props.file));
    this.model.onDidChangeContent((e) =>
      this.props.onValueChange &&
      this.props.onValueChange(this.model.getValue()));
  }

  componentDidMount() {
    const node = findDOMNode<HTMLElement>(this.refs.monaco);
    const options: monaco.editor.IEditorConstructionOptions = {
      selectOnLineNumbers: true,
      roundedSelection: false,
      readOnly: false,
      theme: 'vs',
      cursorStyle: 'line',
      automaticLayout: true,
      cursorBlinking: 'solid',
      model: this.model,
    };
    this.editor = monaco.editor.create(node, options);
    this.editor.onDidChangeCursorPosition((e) => this.setState({cursor: e.position}));
    this.determineSplit();
    window.addEventListener('resize', this.updateDimensions.bind(this));
  }
  componentWillUnmount() {
    this.editor.dispose();
    this.editor = undefined;
    window.removeEventListener('resize', this.updateDimensions.bind(this));
  }

  updateDimensions() {
    this.determineSplit();
  }
  determineSplit() {
    const node = findDOMNode<HTMLElement>(this.refs.root);
    this.setState({split: node.clientHeight > node.clientWidth ? 'horizontal' : 'vertical'});
  }

  render() {
    return (
      <div style={{height: '95vh', width: '95vw'}} ref='root'>
        <SplitPane split={this.state.split} defaultSize='50%' allowResize={true} style={{height: '95%'}}>
          <div ref='monaco' style={{
            height: 'calc(100% - 35px)', width: '100%',
            margin: '1ex', marginRight: '2em',
            overflow: 'hidden'}}/>
          <div style={{overflowY: 'auto', height: '100%', margin: '1ex' }}>
            <InfoView file={this.props.file} cursor={this.state.cursor}/>
          </div>
        </SplitPane>
      </div>
    );
  }
}

const defaultValue =
  '-- Live javascript version of Lean\n\nexample (m n : ℕ) : m + n = n + m :=\nby simp';

function App() {
  let value = defaultValue;
  if (window.location.hash.startsWith('#code=')) {
    value = decodeURI(window.location.hash.substring(6));
  }

  return (
    <LeanEditor file='/test.lean' initialValue={value} onValueChange={(newValue) => {
      history.replaceState(undefined, undefined, '#code=' + encodeURI(newValue));
    }} />
  );
}

const leanJsOpts: LeanJsOpts = {
  javascript: 'https://gebner.github.io/lean-web-editor/lean_js_js.js',
  libraryZip: 'https://gebner.github.io/lean-web-editor/library.zip',
  webassemblyJs: 'https://gebner.github.io/lean-web-editor/lean_js_wasm.js',
  webassemblyWasm: 'https://gebner.github.io/lean-web-editor/lean_js_wasm.wasm',
};

// tslint:disable-next-line:no-var-requires
(window as any).require(['vs/editor/editor.main'], () => {
  registerLeanLanguage(leanJsOpts);
  render(
      <App />,
      document.getElementById('root'),
  );
});
