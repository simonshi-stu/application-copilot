// 本层能证明什么、不能证明什么。宿主和 UI 必须原样或等价展示这些限制。

export const MOKA_DRIVER_LIMITATIONS = Object.freeze([
  '官网页面在独立 Chrome/Edge 窗口，不内嵌到 OpenChamber；OpenChamber 只承载控制台与结果。',
  '生产需要图形桌面以显示独立官网窗口；无显示环境会阻断，不切换到无头模式冒充完成登录。',
  '本层不登录、不读取密码/Cookie/Token、不处理验证码；登录与验证码由本人完成。',
  '登录/SSO 若跳到非 mokahr.com 域名，本层会停止观察和填写；本人完成登录并回到 Moka 官方页面后重新观察。',
  '本层不点击保存、下一步、提交、删除或未知按钮，也不调用表单 submit()/requestSubmit()。',
  '观察会给原生控件设置临时 data-acopilot-control 属性作为快照引用；不改写值、不点击。',
  '写入仅支持可见原生文本框、文本域和单选下拉；Moka 自定义日期、上传、富文本/组合框未支持时会记录 issue。',
  '网站 input/change/blur 可能触发未知联动，且本层不验证网站是否已持久化；必须在官网人工确认后再继续。',
  '观察后控件类型、标签、经历区域、长度、选项、值或禁用状态改变时拒写；已有不同值的控件默认不覆盖。',
  '下拉的占位项可被明确选项替换；已有实质选项或文本值时不覆盖。',
  '重复经历只有在区域和 entityId 稳定可辨时才允许自动填写；无法稳定分组时只展示并请本人处理。',
  '经历/登录区域按标题与类名启发式识别；识别不确定时宁可不填，不猜测归属。',
  '岗位提取只读当前页面可见文本，不滚动加载全部、不展开外链、不访问其它域名；空列表不能证明没有合适职位。',
  '本层不做岗位匹配、录用判断或最终提交；岗位选择、模型复核、保存和提交仍由上层与本人完成。',
  '浏览器 profile 位于项目 .cache 下，但浏览器自身的缓存/日志仍由浏览器管理，不能声称全部在项目目录。',
  '宿主关闭服务前应调用 close()；若进程被强制终止，Chrome/Edge 子进程可能需人工结束。',
  '本人登录后，Chrome/Edge 可能在该独立 profile 中保存 Cookie、localStorage 等会话数据；本层代码不读取这些数据，但 .cache 目录仍需按敏感数据保护。',
  '本层没有模拟成功模式；未安装 Chrome/Edge、pipe 启动失败或页面离开批准域名时明确阻断。',
]);

export const MOKA_FILL_RESULT_NOTE = '写入并即时读回只证明页面控件当前值一致，不代表网站保存成功、提交成功或申请额度已占用。';

export const MOKA_RESEARCH_LIMITS = Object.freeze([
  '只读取当前官方页面已渲染的可见文本与链接，不滚动、不点击、不展开岗位详情。',
  '没有可靠岗位卡时返回 incomplete/blocked，不记录“没有符合职位”，也不冒充已完成检索。',
  '岗位标题、城市、JD 均为页面已见文本；未出现的字段保持 null，不推断。',
  '岗位匹配、资格判断和 1~3 个候选筛选由上层模型与本人确认，不在本层完成。',
]);

export function limitationsForFill() {
  return [...MOKA_DRIVER_LIMITATIONS];
}

export function limitationsForResearch() {
  return [...MOKA_RESEARCH_LIMITS];
}
