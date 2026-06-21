import { defineConfig } from "vitepress";

const zhSidebar = [
  {
    text: "开始",
    items: [
      { text: "文档首页", link: "/zh/" },
      { text: "概念说明", link: "/zh/concepts" },
      {
        text: "使用指南",
        collapsed: false,
        items: [
          { text: "总览与安装", link: "/zh/usage" },
          { text: "远程同步", link: "/zh/usage/remote-sync" },
          { text: "本地迁移", link: "/zh/usage/local-migration" },
          { text: "跨工具转换", link: "/zh/usage/cross-tool" },
          { text: "终端 TUI", link: "/zh/usage/tui" },
          { text: "自定义会话路径", link: "/zh/usage/custom-paths" }
        ]
      }
    ]
  },
  {
    text: "深入了解",
    items: [
      { text: "工具执行链路", link: "/zh/execution-flow" },
      { text: "平台发展规划", link: "/zh/agent-conversation-platform" },
      { text: "开发说明", link: "/zh/development" },
      { text: "发布与发版指南", link: "/zh/publishing" }
    ]
  }
];

const enSidebar = [
  {
    text: "Start",
    items: [
      { text: "Documentation", link: "/en/" },
      { text: "Concepts", link: "/en/concepts" },
      {
        text: "Usage Guide",
        collapsed: false,
        items: [
          { text: "Overview & Install", link: "/en/usage" },
          { text: "Remote Sync", link: "/en/usage/remote-sync" },
          { text: "Local Migration", link: "/en/usage/local-migration" },
          { text: "Cross-Tool Transform", link: "/en/usage/cross-tool" },
          { text: "Terminal TUI", link: "/en/usage/tui" },
          { text: "Custom Session Roots", link: "/en/usage/custom-paths" }
        ]
      }
    ]
  },
  {
    text: "Details",
    items: [
      { text: "Execution Flow", link: "/en/execution-flow" },
      { text: "Platform Roadmap", link: "/en/agent-conversation-platform" },
      { text: "Development", link: "/en/development" },
      { text: "Release and Publishing", link: "/en/publishing" }
    ]
  }
];

export default defineConfig({
  lang: "zh-CN",
  title: "Agent-Sync",
  description: "Git for your AI coding sessions.",
  base: "/Git-Agent-Sync/",
  cleanUrls: true,
  srcExclude: [
    "README.md",
    "README.zh-CN.md",
    "usage.md",
    "usage.zh-CN.md",
    "concepts.md",
    "concepts.zh-CN.md",
    "execution-flow.md",
    "execution-flow.zh-CN.md",
    "development.md",
    "development.zh-CN.md",
    "publishing.md",
    "publishing.zh-CN.md"
  ],
  lastUpdated: true,
  ignoreDeadLinks: [
    /^https:\/\/github\.com\/Wood-Q\/Git-Agent-Sync/
  ],
  head: [
    ["link", { rel: "icon", href: "/Git-Agent-Sync/logo.svg", type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#151924" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Agent-Sync" }],
    ["meta", { property: "og:description", content: "Git for your AI coding sessions." }],
    ["meta", { property: "og:image", content: "https://wood-q.github.io/Git-Agent-Sync/logo.png" }]
  ],
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Agent-Sync",
    search: {
      provider: "local",
      options: {
        translations: {
          button: {
            buttonText: "搜索"
          },
          modal: {
            displayDetails: "显示详情",
            resetButtonTitle: "清除搜索",
            backButtonTitle: "关闭搜索",
            noResultsText: "没有找到",
            footer: {
              selectText: "选择",
              selectKeyAriaLabel: "回车",
              navigateText: "切换",
              navigateUpKeyAriaLabel: "上箭头",
              navigateDownKeyAriaLabel: "下箭头",
              closeText: "关闭",
              closeKeyAriaLabel: "Esc"
            }
          }
        },
        locales: {
          zh: {
            translations: {
              button: {
                buttonText: "搜索"
              },
              modal: {
                displayDetails: "显示详情",
                resetButtonTitle: "清除搜索",
                backButtonTitle: "关闭搜索",
                noResultsText: "没有找到",
                footer: {
                  selectText: "选择",
                  selectKeyAriaLabel: "回车",
                  navigateText: "切换",
                  navigateUpKeyAriaLabel: "上箭头",
                  navigateDownKeyAriaLabel: "下箭头",
                  closeText: "关闭",
                  closeKeyAriaLabel: "Esc"
                }
              }
            }
          },
          en: {
            translations: {
              button: {
                buttonText: "Search"
              },
              modal: {
                displayDetails: "Display detailed list",
                resetButtonTitle: "Reset search",
                backButtonTitle: "Close search",
                noResultsText: "No results for",
                footer: {
                  selectText: "to select",
                  selectKeyAriaLabel: "enter",
                  navigateText: "to navigate",
                  navigateUpKeyAriaLabel: "up arrow",
                  navigateDownKeyAriaLabel: "down arrow",
                  closeText: "to close",
                  closeKeyAriaLabel: "escape"
                }
              }
            }
          }
        }
      }
    },
    nav: [
      { text: "简体中文", link: "/zh/" },
      { text: "English", link: "/en/" },
      { text: "GitHub", link: "https://github.com/Wood-Q/Git-Agent-Sync" }
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/Wood-Q/Git-Agent-Sync" }
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Agent-Sync contributors"
    },
    lastUpdated: {
      text: "最后更新",
      formatOptions: {
        dateStyle: "medium",
        timeStyle: "short"
      }
    },
    outline: {
      label: "本页目录"
    },
    docFooter: {
      prev: "上一页",
      next: "下一页"
    },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "外观",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式"
  },
  locales: {
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      title: "Agent-Sync",
      description: "像同步代码一样同步 AI 编程会话。",
      themeConfig: {
        nav: [
          { text: "首页", link: "/zh/" },
          { text: "使用指南", link: "/zh/usage" },
          { text: "概念", link: "/zh/concepts" },
          { text: "GitHub", link: "https://github.com/Wood-Q/Git-Agent-Sync" }
        ],
        sidebar: {
          "/zh/": zhSidebar
        },
        footer: {
          message: "Released under the MIT License.",
          copyright: "Copyright © 2026 Agent-Sync contributors"
        },
        lastUpdated: {
          text: "最后更新",
          formatOptions: {
            dateStyle: "medium",
            timeStyle: "short"
          }
        },
        outline: {
          label: "本页目录"
        },
        docFooter: {
          prev: "上一页",
          next: "下一页"
        },
        returnToTopLabel: "回到顶部",
        langMenuLabel: "切换语言",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "外观",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式"
      }
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      title: "Agent-Sync",
      description: "Sync AI coding sessions like source code.",
      themeConfig: {
        nav: [
          { text: "Home", link: "/en/" },
          { text: "Usage", link: "/en/usage" },
          { text: "Concepts", link: "/en/concepts" },
          { text: "GitHub", link: "https://github.com/Wood-Q/Git-Agent-Sync" }
        ],
        sidebar: {
          "/en/": enSidebar
        },
        footer: {
          message: "Released under the MIT License.",
          copyright: "Copyright © 2026 Agent-Sync contributors"
        },
        outline: {
          label: "On this page"
        },
        lastUpdated: {
          text: "Last updated"
        },
        docFooter: {
          prev: "Previous page",
          next: "Next page"
        },
        returnToTopLabel: "Return to top",
        sidebarMenuLabel: "Menu",
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme"
      }
    }
  }
});
