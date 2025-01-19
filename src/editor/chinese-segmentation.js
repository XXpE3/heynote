import { Segment, useDefault } from 'segmentit';
import { ViewPlugin, Decoration, EditorView, keymap } from "@codemirror/view";
import { RangeSetBuilder, EditorSelection, Facet, findClusterBreak, Prec } from "@codemirror/state";
import { 
  cursorGroupLeft, cursorGroupRight, 
  selectGroupLeft, selectGroupRight,
  deleteGroupBackward, deleteGroupForward
} from "@codemirror/commands";

// 创建分词器实例并加载默认词典
const segment = useDefault(new Segment());

// 创建一个装饰器标记类
const segmentMark = Decoration.mark({ class: "cm-chinese-segment" });

// 判断是否包含中文字符
function containsChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text);
}

// 在指定位置查找中文词语
function findChineseWordAt(text, pos) {
  if (!containsChinese(text)) return null;
  
  const segments = segment.doSegment(text);
  let currentPos = 0;
  
  for (let seg of segments) {
    const start = currentPos;
    const end = start + seg.w.length;
    
    if (pos >= start && pos < end) {
      return { from: start, to: end, word: seg.w };
    }
    
    currentPos = end;
  }
  
  return null;
}

// 在指定位置查找下一个或上一个中文词语
function findNextChineseWord(text, pos, forward = true) {
  if (!containsChinese(text)) return null;
  
  const segments = segment.doSegment(text);
  let currentPos = 0;
  let prevWord = null;
  
  for (let seg of segments) {
    const start = currentPos;
    const end = start + seg.w.length;
    
    if (forward) {
      if (start > pos) {
        return { from: start, to: end, word: seg.w };
      }
    } else {
      // 向左移动时，如果当前位置在词内或词后，返回前一个词
      if (start >= pos) {
        return prevWord;
      }
      // 记录前一个词，以便在找到目标位置时返回
      prevWord = { from: start, to: end, word: seg.w };
    }
    
    currentPos = end;
  }
  
  // 向右移动时没找到下一个词，或者向左移动时已经到达最左边，返回最后记录的词
  return forward ? null : prevWord;
}

// 获取下一个词组位置
function getSegDestFromGroup(startPos, nextPos, sliceDoc) {
  const forward = startPos < nextPos;
  const text = forward ? 
    sliceDoc(startPos, nextPos) : 
    sliceDoc(nextPos, startPos);

  if (!containsChinese(text)) return null;

  const segments = segment.doSegment(text);
  if (segments.length === 0) return null;

  let length = 0;
  const seg = forward ? segments[0] : segments[segments.length - 1];
  length = seg.w.length;

  return forward ? startPos + length : startPos - length;
}

// 创建中文分词插件
const chineseSegmentationPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view);
    this.handleDblClick = this.handleDblClick.bind(this);
    this.view = view;
  }

  handleDblClick(event) {
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;

    const line = this.view.state.doc.lineAt(pos);
    const wordInfo = findChineseWordAt(line.text, pos - line.from);
    
    if (wordInfo) {
      event.preventDefault();
      this.view.dispatch({
        selection: EditorSelection.single(line.from + wordInfo.from, line.from + wordInfo.to)
      });
    }
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
    this.view = update.view;
  }

  buildDecorations(view) {
    const builder = new RangeSetBuilder();
    
    for (let { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      
      if (containsChinese(text)) {
        const segments = segment.doSegment(text);
        let pos = 0;
        
        for (let seg of segments) {
          const start = from + pos;
          const end = start + seg.w.length;
          builder.add(start, end, segmentMark);
          pos += seg.w.length;
        }
      }
    }
    
    return builder.finish();
  }
}, {
  decorations: v => v.decorations,
  eventHandlers: {
    dblclick: (e, view) => {
      view.plugin(chineseSegmentationPlugin)?.handleDblClick(e);
    }
  }
});

// 删除词组
function deleteByGroup(target, forward) {
  console.log("deleteByGroup called", forward);
  if (target.state.readOnly) return false;
  
  const event = "delete.selection";
  const { state } = target;
  
  const changes = state.changeByRange(range => {
    let { from, to } = range;
    
    if (from == to) {
      const line = state.doc.lineAt(from);
      const text = line.text;
      const relativePos = from - line.from;
      
      // 检查当前位置是否在中文文本中
      if (containsChinese(text)) {
        // 向前删除时直接使用 findNextChineseWord，不再使用 findChineseWordAt
        const wordInfo = findNextChineseWord(text, relativePos, forward);
        
        if (wordInfo) {
          console.log("Found Chinese word:", wordInfo);
          if (forward) {
            // 向后删除：从当前位置删除到下一个词的结束位置
            from = line.from + relativePos;
            to = line.from + wordInfo.to;
          } else {
            // 向前删除：从前一个词的开始位置删除到当前位置
            from = line.from + wordInfo.from;
            to = line.from + relativePos;
          }
          return {
            changes: { from, to },
            range: EditorSelection.cursor(from)
          };
        }
      }
      
      // 如果不是中文或没找到中文词，使用默认的删除词组逻辑
      const defaultCommand = forward ? deleteGroupForward : deleteGroupBackward;
      return defaultCommand(target)(range);
    }
    
    return {
      changes: { from, to },
      range: EditorSelection.cursor(from)
    };
  });
  
  target.dispatch(
    state.update(changes, {
      scrollIntoView: true,
      userEvent: event
    })
  );
  
  return true;
}

// 移动到下一个词组
function moveByGroup(target, forward, extend = false) {
  console.log("moveByGroup called", forward, extend);
  const { state } = target;
  
  const changes = state.changeByRange(range => {
    const pos = range.head;
    const line = state.doc.lineAt(pos);
    const text = line.text;
    const relativePos = pos - line.from;
    
    // 检查当前位置是否在中文文本中
    if (containsChinese(text)) {
      const wordInfo = forward ?
        findNextChineseWord(text, relativePos, true) :
        findNextChineseWord(text, relativePos, false);
      
      if (wordInfo) {
        console.log("Found Chinese word:", wordInfo);
        // 无论是向左还是向右移动，都使用词的开始位置
        const newPos = line.from + wordInfo.from;
        return {
          range: extend ? 
            EditorSelection.range(range.anchor, newPos) :
            EditorSelection.cursor(newPos)
        };
      }
    }
    
    // 如果不是中文或没找到中文词，使用默认的词移动逻辑
    const defaultCommand = forward ?
      (extend ? selectGroupRight : cursorGroupRight) :
      (extend ? selectGroupLeft : cursorGroupLeft);
    
    // 直接返回默认命令的结果
    return defaultCommand(target)(range);
  });
  
  target.dispatch(
    state.update(changes, {
      scrollIntoView: true,
      userEvent: extend ? "select" : "move"
    })
  );
  
  return true;
}

// 创建命令
const moveWordLeft = target => {
  console.log("moveWordLeft called");
  return moveByGroup(target, false);
};
const moveWordRight = target => {
  console.log("moveWordRight called");
  return moveByGroup(target, true);
};
const selectWordLeft = target => {
  console.log("selectWordLeft called");
  return moveByGroup(target, false, true);
};
const selectWordRight = target => {
  console.log("selectWordRight called");
  return moveByGroup(target, true, true);
};
const deleteWordBackward = target => {
  console.log("deleteWordBackward called");
  return deleteByGroup(target, false);
};
const deleteWordForward = target => {
  console.log("deleteWordForward called");
  return deleteByGroup(target, true);
};

// 注册快捷键
const chineseSegmentationKeymap = Prec.highest(keymap.of([
  { key: "Alt-ArrowLeft", run: moveWordLeft, preventDefault: true },
  { key: "Alt-ArrowRight", run: moveWordRight, preventDefault: true },
  { key: "Shift-Alt-ArrowLeft", run: selectWordLeft, preventDefault: true },
  { key: "Shift-Alt-ArrowRight", run: selectWordRight, preventDefault: true },
  { key: "Alt-Backspace", run: deleteWordBackward, preventDefault: true },
  { key: "Alt-Delete", run: deleteWordForward, preventDefault: true },
  // Mac 特定快捷键
  { key: "Mod-Backspace", mac: "Alt-Backspace", run: deleteWordBackward, preventDefault: true },
  { key: "Mod-Delete", mac: "Alt-Delete", run: deleteWordForward, preventDefault: true }
]));

export const chineseSegmentation = [
  chineseSegmentationPlugin,
  chineseSegmentationKeymap
]; 