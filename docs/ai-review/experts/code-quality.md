# Code quality expert (seed rules)

- 变更是否与现有模块风格一致（命名、错误处理、类型）。
- 复杂分支是否缺少测试或文档；public API 是否破坏兼容。
- 明显 dead code、重复逻辑、过大函数（>80 行）可建议拆分。
- CI/Actions：权限最小化、secrets 勿 echo。
- 仅对 **本次 diff 引入或修改** 的问题给 finding；勿全盘否定。
