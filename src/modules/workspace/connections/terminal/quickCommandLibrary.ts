import type { QuickCommand } from "../../../../types";

export type QuickCommandLibraryCategory = {
  categoryKey: string;
  subcategoryKeys: string[];
};

export type QuickCommandLibraryEntry = Omit<QuickCommand, "id" | "label"> & {
  libraryId: string;
  categoryKey: string;
  subcategoryKey: string;
  labelKey: string;
  descriptionKey: string;
};

const key = (name: string) => `terminal.quickCommandLibrary.entries.${name}` as const;

export const QUICK_COMMAND_LIBRARY_CATEGORIES: QuickCommandLibraryCategory[] = [
  {
    categoryKey: "terminal.quickCommandLibrary.categories.aiAgents",
    subcategoryKeys: [
      "terminal.quickCommandLibrary.subcategories.codingAgents",
      "terminal.quickCommandLibrary.subcategories.autonomousAgents",
    ],
  },
  {
    categoryKey: "terminal.quickCommandLibrary.categories.developerWorkflow",
    subcategoryKeys: [
      "terminal.quickCommandLibrary.subcategories.git",
      "terminal.quickCommandLibrary.subcategories.packageManagersRuntimes",
    ],
  },
  {
    categoryKey: "terminal.quickCommandLibrary.categories.containersKubernetes",
    subcategoryKeys: [
      "terminal.quickCommandLibrary.subcategories.docker",
      "terminal.quickCommandLibrary.subcategories.dockerCompose",
      "terminal.quickCommandLibrary.subcategories.kubectl",
    ],
  },
  {
    categoryKey: "terminal.quickCommandLibrary.categories.linuxAdministration",
    subcategoryKeys: [
      "terminal.quickCommandLibrary.subcategories.servicesLogs",
      "terminal.quickCommandLibrary.subcategories.packages",
    ],
  },
  {
    categoryKey: "terminal.quickCommandLibrary.categories.macosAdministration",
    subcategoryKeys: [
      "terminal.quickCommandLibrary.subcategories.softwareUpdate",
      "terminal.quickCommandLibrary.subcategories.networking",
      "terminal.quickCommandLibrary.subcategories.launchdPower",
      "terminal.quickCommandLibrary.subcategories.preferences",
    ],
  },
];

function entry(
  libraryId: string,
  category: string,
  subcategory: string,
  entryName: string,
  command: string,
  iconName: QuickCommand["iconName"],
  accentName: QuickCommand["accentName"],
  confirm = false,
  sendEnter = true,
): QuickCommandLibraryEntry {
  return {
    libraryId,
    categoryKey: `terminal.quickCommandLibrary.categories.${category}`,
    subcategoryKey: `terminal.quickCommandLibrary.subcategories.${subcategory}`,
    labelKey: `${key(entryName)}.label`,
    descriptionKey: `${key(entryName)}.description`,
    command,
    iconName,
    accentName,
    sendEnter,
    confirm,
  };
}

export const QUICK_COMMAND_LIBRARY: QuickCommandLibraryEntry[] = [
  entry("ai-claude-native-install", "aiAgents", "codingAgents", "aiClaudeNativeInstall", "curl -fsSL https://claude.ai/install.sh | bash", "Package", "purple"),
  entry("ai-claude-start", "aiAgents", "codingAgents", "aiClaudeStart", "claude", "Bot", "purple"),
  entry("ai-claude-bypass", "aiAgents", "codingAgents", "aiClaudeBypass", "claude --dangerously-skip-permissions", "Shield", "red", true),
  entry("ai-claude-brew-install", "aiAgents", "codingAgents", "aiClaudeBrewInstall", "brew install --cask claude-code", "Package", "purple"),
  entry("ai-claude-brew-upgrade", "aiAgents", "codingAgents", "aiClaudeBrewUpgrade", "brew upgrade claude-code", "Upload", "purple", true),
  entry("ai-codex-npm-install", "aiAgents", "codingAgents", "aiCodexNpmInstall", "npm i -g @openai/codex", "Package", "green"),
  entry("ai-codex-brew-install", "aiAgents", "codingAgents", "aiCodexBrewInstall", "brew install --cask codex", "Package", "green"),
  entry("ai-codex-start", "aiAgents", "codingAgents", "aiCodexStart", "codex", "Terminal", "green"),
  entry("ai-codex-prompt", "aiAgents", "codingAgents", "aiCodexPrompt", 'codex "Explain this codebase to me"', "MessageSquare", "green"),
  entry("ai-codex-mcp-context7", "aiAgents", "codingAgents", "aiCodexMcpContext7", "codex mcp add context7 -- npx -y @upstash/context7-mcp", "Webhook", "green", true),
  entry("ai-codex-npm-upgrade", "aiAgents", "codingAgents", "aiCodexNpmUpgrade", "npm i -g @openai/codex@latest", "Upload", "green", true),
  entry("ai-gemini-install", "aiAgents", "codingAgents", "aiGeminiInstall", "npm install -g @google/gemini-cli@latest", "Package", "blue"),
  entry("ai-gemini-start", "aiAgents", "codingAgents", "aiGeminiStart", "gemini", "Sparkles", "blue"),
  entry("ai-qwen-npm-install", "aiAgents", "codingAgents", "aiQwenNpmInstall", "npm install -g @qwen-code/qwen-code@latest", "Package", "indigo"),
  entry("ai-qwen-brew-install", "aiAgents", "codingAgents", "aiQwenBrewInstall", "brew install qwen-code", "Package", "indigo"),
  entry("ai-qwen-start", "aiAgents", "codingAgents", "aiQwenStart", "qwen", "SquareTerminal", "indigo"),
  entry("ai-aider-install", "aiAgents", "codingAgents", "aiAiderInstall", "curl -LsSf https://aider.chat/install.sh | sh", "Package", "cyan"),
  entry("ai-aider-message", "aiAgents", "codingAgents", "aiAiderMessage", 'aider --message "make a script that prints hello" hello.js', "FileCode", "cyan"),
  entry("ai-aider-gemini", "aiAgents", "codingAgents", "aiAiderGemini", "aider --model gemini", "Bot", "cyan"),
  entry("ai-openclaw-install", "aiAgents", "autonomousAgents", "aiOpenclawInstall", "curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash", "Cloud", "orange"),
  entry("ai-openclaw-npm-install", "aiAgents", "autonomousAgents", "aiOpenclawNpmInstall", "npm install -g openclaw@latest", "Package", "orange"),
  entry("ai-openclaw-onboard", "aiAgents", "autonomousAgents", "aiOpenclawOnboard", "openclaw onboard", "Wrench", "orange"),
  entry("ai-openclaw-daemon", "aiAgents", "autonomousAgents", "aiOpenclawDaemon", "openclaw onboard --install-daemon", "Server", "orange", true),
  entry("ai-openclaw-update", "aiAgents", "autonomousAgents", "aiOpenclawUpdate", "openclaw update", "Upload", "orange", true),
  entry("ai-hermes-install", "aiAgents", "autonomousAgents", "aiHermesInstall", "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash", "Package", "cyan"),
  entry("ai-hermes-start", "aiAgents", "autonomousAgents", "aiHermesStart", "hermes", "Bot", "cyan"),
  entry("ai-hermes-setup", "aiAgents", "autonomousAgents", "aiHermesSetup", "hermes setup", "Settings", "cyan"),
  entry("ai-hermes-model", "aiAgents", "autonomousAgents", "aiHermesModel", "hermes model", "SlidersHorizontal", "cyan"),
  entry("ai-hermes-doctor", "aiAgents", "autonomousAgents", "aiHermesDoctor", "hermes doctor", "HeartPulse", "cyan"),
  entry("ai-hermes-dashboard", "aiAgents", "autonomousAgents", "aiHermesDashboard", "hermes dashboard", "PanelTop", "cyan"),
  entry("ai-goose-install", "aiAgents", "autonomousAgents", "aiGooseInstall", "curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash", "Package", "amber"),

  entry("dev-git-switch", "developerWorkflow", "git", "devGitSwitch", "git switch -c <branch-name>", "GitBranch", "green", false, false),
  entry("dev-git-pull-rebase", "developerWorkflow", "git", "devGitPullRebase", "git pull --rebase", "GitFork", "green", true),
  entry("dev-git-restore-head", "developerWorkflow", "git", "devGitRestoreHead", "git restore --source=HEAD -- .", "Archive", "amber", true),
  entry("dev-git-clean", "developerWorkflow", "git", "devGitClean", "git clean -fd", "Trash", "red", true),
  entry("dev-git-revert", "developerWorkflow", "git", "devGitRevert", "git revert <commit>", "GitCommit", "amber", true, false),
  entry("dev-homebrew-install", "developerWorkflow", "packageManagersRuntimes", "devHomebrewInstall", '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', "Package", "slate"),
  entry("dev-brew-bundle-global", "developerWorkflow", "packageManagersRuntimes", "devBrewBundleGlobal", "brew bundle install --global", "ListChecks", "slate"),
  entry("dev-nvm-install", "developerWorkflow", "packageManagersRuntimes", "devNvmInstall", "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash", "Package", "green"),
  entry("dev-nvm-install-node-24", "developerWorkflow", "packageManagersRuntimes", "devNvmInstallNode24", "nvm install 24", "PackageCheck", "green"),
  entry("dev-nvm-use-node-24", "developerWorkflow", "packageManagersRuntimes", "devNvmUseNode24", "nvm use 24", "Play", "green"),
  entry("dev-brew-claude", "developerWorkflow", "packageManagersRuntimes", "devBrewClaude", "brew install --cask claude-code", "Package", "purple"),
  entry("dev-brew-codex", "developerWorkflow", "packageManagersRuntimes", "devBrewCodex", "brew install --cask codex", "Package", "green"),
  entry("dev-brew-docker", "developerWorkflow", "packageManagersRuntimes", "devBrewDocker", "brew install --cask docker-desktop", "Container", "blue"),
  entry("dev-brew-kubectl", "developerWorkflow", "packageManagersRuntimes", "devBrewKubectl", "brew install kubectl", "Package", "indigo"),

  entry("container-docker-ps", "containersKubernetes", "docker", "containerDockerPs", "docker ps", "Container", "blue"),
  entry("container-docker-logs", "containersKubernetes", "docker", "containerDockerLogs", "docker logs --follow <container>", "List", "sky", false, false),
  entry("container-docker-stop", "containersKubernetes", "docker", "containerDockerStop", "docker stop <container>", "XCircle", "red", true, false),
  entry("container-compose-up", "containersKubernetes", "dockerCompose", "containerComposeUp", "docker compose up -d", "Play", "blue", true),
  entry("container-compose-exec", "containersKubernetes", "dockerCompose", "containerComposeExec", "docker compose exec web sh", "Terminal", "blue"),
  entry("container-kubectl-version", "containersKubernetes", "kubectl", "containerKubectlVersion", "kubectl version --client", "BadgeCheck", "indigo"),
  entry("container-kubectl-pods", "containersKubernetes", "kubectl", "containerKubectlPods", "kubectl get pods -A", "Layers", "indigo"),
  entry("container-kubectl-logs", "containersKubernetes", "kubectl", "containerKubectlLogs", "kubectl logs -f <pod>", "List", "indigo", false, false),
  entry("container-kubectl-exec", "containersKubernetes", "kubectl", "containerKubectlExec", "kubectl exec -it <pod> -- sh", "Terminal", "indigo", false, false),
  entry("container-kubectl-apply", "containersKubernetes", "kubectl", "containerKubectlApply", "kubectl apply -f k8s.yaml", "Upload", "indigo", true),

  entry("linux-systemctl-status-sshd", "linuxAdministration", "servicesLogs", "linuxSystemctlStatusSshd", "systemctl status sshd", "Activity", "blue"),
  entry("linux-systemctl-restart-sshd", "linuxAdministration", "servicesLogs", "linuxSystemctlRestartSshd", "sudo systemctl restart sshd", "Power", "amber", true),
  entry("linux-systemctl-enable-docker", "linuxAdministration", "servicesLogs", "linuxSystemctlEnableDocker", "sudo systemctl enable --now docker", "Power", "green", true),
  entry("linux-journalctl-sshd", "linuxAdministration", "servicesLogs", "linuxJournalctlSshd", "journalctl _SYSTEMD_UNIT=sshd.service", "FileText", "blue"),
  entry("linux-apt-upgrade", "linuxAdministration", "packages", "linuxAptUpgrade", "sudo apt update && sudo apt upgrade -y", "Upload", "orange", true),
  entry("linux-apt-install-docker", "linuxAdministration", "packages", "linuxAptInstallDocker", "sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin", "Package", "blue"),
  entry("linux-dnf-upgrade", "linuxAdministration", "packages", "linuxDnfUpgrade", "sudo dnf upgrade", "Upload", "orange", true),
  entry("linux-dnf-install-compose", "linuxAdministration", "packages", "linuxDnfInstallCompose", "sudo dnf install docker-compose-plugin", "Package", "blue"),

  entry("macos-softwareupdate-installers", "macosAdministration", "softwareUpdate", "macosSoftwareupdateInstallers", "softwareupdate --list-full-installers", "List", "slate"),
  entry("macos-networksetup-services", "macosAdministration", "networking", "macosNetworksetupServices", "networksetup -listallnetworkservices", "Network", "blue"),
  entry("macos-networksetup-manual", "macosAdministration", "networking", "macosNetworksetupManual", 'networksetup -setmanual "Ethernet" <ip-address> <subnet-mask> <router>', "Wifi", "amber", true, false),
  entry("macos-pmset-schedule", "macosAdministration", "launchdPower", "macosPmsetSchedule", "pmset -g sched", "Clock", "slate"),
  entry("macos-pmset-repeat-wake", "macosAdministration", "launchdPower", "macosPmsetRepeatWake", "sudo pmset repeat wake M 8:00:00", "Sun", "amber", true),
  entry("macos-pmset-repeat-cancel", "macosAdministration", "launchdPower", "macosPmsetRepeatCancel", "sudo pmset repeat cancel", "XCircle", "red", true),
  entry("macos-defaults-read", "macosAdministration", "preferences", "macosDefaultsRead", "defaults read <domain>", "FileText", "slate", false, false),
  entry("macos-defaults-write", "macosAdministration", "preferences", "macosDefaultsWrite", "defaults write <domain> <key> <value>", "Settings", "amber", true, false),
];
