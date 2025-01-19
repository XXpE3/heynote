import { Segment, useDefault } from 'segmentit';
import { ViewPlugin, Decoration, EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// 创建分词器实例并加载默认词典
const segment = useDefault(new Segment());
// 不需要手动调用 loadDict，因为 useDefault 已经加载了默认词典

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

// 创建中文分词插件
export const chineseSegmentation = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view);
    this.handleDblClick = this.handleDblClick.bind(this);
    view.dom.addEventListener('dblclick', this.handleDblClick);
  }

  destroy(view) {
    view.dom.removeEventListener('dblclick', this.handleDblClick);
  }

  handleDblClick(event) {
    const view = this.view;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;

    const line = view.state.doc.lineAt(pos);
    const wordInfo = findChineseWordAt(line.text, pos - line.from);
    
    if (wordInfo) {
      event.preventDefault();
      view.dispatch({
        selection: {
          anchor: line.from + wordInfo.from,
          head: line.from + wordInfo.to
        }
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
    
    // 遍历可见行
    for (let { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      
      // 如果包含中文字符，进行分词
      if (containsChinese(text)) {
        const segments = segment.doSegment(text);
        let pos = 0;
        
        // 为每个分词添加装饰
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
}); 