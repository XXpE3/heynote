import { Segment, useDefault } from 'segmentit';
import { ViewPlugin, Decoration } from "@codemirror/view";
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

// 创建中文分词插件
export const chineseSegmentation = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
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