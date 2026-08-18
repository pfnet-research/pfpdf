# 8. security model

## 8.1 trust model

pfpdf は raw HTML と利用者 script を処理し得るため、入力文書を信頼するローカル build tool と定義します。CI service として不特定ユーザーの入力を処理する用途はサポートしません。

利用者向けに `SECURITY.md` には少なくとも次を記載します。

- 信頼できない文書を実行しない
- raw HTML、script、外部 URL は Chromium 上で動作・取得され得る
- GitHub.com の post-render sanitization は行わず、GFM の Disallowed Raw HTML tag filter も自由度を優先して適用しない
- raw HTML と custom template は pfpdf process から参照可能な local file を読み、remote endpoint へ送信し得る。renderer は信頼できない入力の sandbox ではない
- 静的 local resource の `..`、absolute path、symlink target を input root だけの allowlist で制限しない
- script が実行時に生成する local path は静的 resource graph の対象外で、renderer は参照を保証しない
- ホストフォントの直接参照は再配布を避ける手段であり、利用権や PDF への埋め込み権を与えるものではない
- custom template と logo は利用者が権利と内容を確認した trusted input として扱う
- 脆弱性の非公開報告先
- サポート中の release 系列

## 8.2 実装上の原則

- child process に `shell: true` を使わない。shell 文字列を組み立てず、引数配列で起動する
- telemetry、update check、crash report を外部へ送信しない
- browser は pinned Vivliostyle CLI の標準管理または利用者が明示した path を使う
- loopback `AssetServer` は `127.0.0.1` だけへ bind する。resource manifest は renderer-neutral な URL 解決のために使い、file access の security boundary としては扱わない
- font file の埋め込み制限を検出できた場合は無視せず、font 名と対応方法を表示する
- temporary path を予測可能な固定名にしない
- workspace は利用者だけが読める permission で作り、最終出力の sibling 一時 file は exclusive create する。既存 symlink や file を一時出力として再利用しない
- Chromium sandbox を理由なく無効化しない
- browser binary cache と実行 profile を分離し、既存の利用者 browser profile や cookie store を使わない
- browser download、integrity、cache 展開は Vivliostyle CLI と browser manager の責務とし、pfpdf で重複実装しない
- child process は通常の CLI tool と同様に呼出元の環境変数を継承する。入力文書と custom template はそれらを参照し得る trusted code として扱う
- diagnostic は renderer の出力を改変せず表示・保存する。入力由来の control character や credential を含む URL を log へ出したくない場合は、利用者が文書と実行環境を調整する
- YAML front matter は既存 YAML library の JSON schema で mapping として読み、pfpdf が利用する metadata field の名前と型だけを検査する
- HTML、CSS、URL、OpenType は専用 parser の token / table 境界上で処理し、正規表現による再解析や未検証 offset read を避ける
- renderer phase 全体に finite な deadline を適用し、timeout 後は child と listener を回収する。trusted input であっても停止した browser download、script、browser を無期限に待たない

## 8.3 sandbox に関する位置付け

- pfpdf の local resource graph は correctness のための機構であり、信頼できない入力に対する security boundary ではない
- document 内の trusted script は同じ origin の resource を読み、remote endpoint へ送信し得るため、AssetServer は機密性を保証しない
- Chromium sandbox は defense in depth として維持するが、それを理由に信頼できない文書の処理を安全と表現しない
- remote resource の取得結果は保証せず、再現性・network error・credential 流出の可能性が利用者責任であることを README と `SECURITY.md` に明記する

## 8.4 Ubuntu の user namespace 制限

Ubuntu 23.10 以降には unprivileged user namespace の制限があり、shared library が揃っていても Chromium sandbox を起動できない場合があります。pfpdf は sandbox 起因の失敗を library 不足と区別して診断します。AppArmor profile の追加など root 作業を伴う回避手順は tutorial の troubleshooting 章に記載し、pfpdf が root 権限で暗黙に設定を変更することはしません。
