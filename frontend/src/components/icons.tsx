import type { CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BellOff,
  Bot,
  Bug,
  Calculator,
  CalendarDays,
  ChartLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Gem,
  Gift,
  Globe,
  History,
  Info,
  Lightbulb,
  Link2,
  Loader2,
  Lock,
  Medal,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Package,
  Palette,
  PartyPopper,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Rocket,
  ScanLine,
  Search,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sprout,
  Star,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  User,
  Users,
  Wallet,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single icon system for the whole app — lucide-react, one stroke width (2),
 * one corner style, one size default (20). Everything else (emoji, text
 * glyphs, ad-hoc SVGs) is banned from functional UI per the redesign spec.
 */

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  fill?: string;
  style?: CSSProperties;
}

const ICONS: Record<string, LucideIcon> = {
  Gauge,
  ArrowLeftRight,
  Wallet,
  User,
  Bell,
  BellOff,
  Star,
  Search,
  TrendingUp,
  ChartLine,
  Clock,
  AlertTriangle,
  Trash2,
  X,
  Check,
  Lock,
  Download,
  Share2,
  Zap,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Calculator,
  Flame,
  Trophy,
  Globe,
  Settings,
  Eye,
  EyeOff,
  ExternalLink,
  Plus,
  Minus,
  SlidersHorizontal,
  Sparkles,
  Play,
  Send,
  Copy,
  CheckCircle2,
  XCircle,
  History,
  Link2,
  QrCode,
  ShieldAlert,
  Info,
  Lightbulb,
  Loader2,
  Bot,
  Bug,
  Gift,
  Medal,
  MessageCircle,
  MoreHorizontal,
  ScanLine,
  Smartphone,
  Users,
  CalendarDays,
  CircleDollarSign,
  Gem,
  Package,
  Palette,
  PartyPopper,
  Rocket,
  Sprout,
  Target,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, strokeWidth = 2, fill, className, style }: IconProps & { name: IconName }) {
  const Comp = ICONS[name];
  return <Comp size={size} strokeWidth={strokeWidth} fill={fill} className={className} style={style} aria-hidden="true" />;
}

export const IconGauge = (props: IconProps) => <Icon name="Gauge" {...props} />;
export const IconArrowLeftRight = (props: IconProps) => <Icon name="ArrowLeftRight" {...props} />;
export const IconWallet = (props: IconProps) => <Icon name="Wallet" {...props} />;
export const IconUser = (props: IconProps) => <Icon name="User" {...props} />;
export const IconBell = (props: IconProps) => <Icon name="Bell" {...props} />;
export const IconBellOff = (props: IconProps) => <Icon name="BellOff" {...props} />;
export const IconStar = (props: IconProps) => <Icon name="Star" {...props} />;
export const IconSearch = (props: IconProps) => <Icon name="Search" {...props} />;
export const IconTrendingUp = (props: IconProps) => <Icon name="TrendingUp" {...props} />;
export const IconChartLine = (props: IconProps) => <Icon name="ChartLine" {...props} />;
export const IconClock = (props: IconProps) => <Icon name="Clock" {...props} />;
export const IconAlertTriangle = (props: IconProps) => <Icon name="AlertTriangle" {...props} />;
export const IconTrash2 = (props: IconProps) => <Icon name="Trash2" {...props} />;
export const IconX = (props: IconProps) => <Icon name="X" {...props} />;
export const IconCheck = (props: IconProps) => <Icon name="Check" {...props} />;
export const IconLock = (props: IconProps) => <Icon name="Lock" {...props} />;
export const IconDownload = (props: IconProps) => <Icon name="Download" {...props} />;
export const IconArrowDown = (props: IconProps) => <Icon name="ArrowDown" {...props} />;
export const IconShare2 = (props: IconProps) => <Icon name="Share2" {...props} />;
export const IconZap = (props: IconProps) => <Icon name="Zap" {...props} />;
export const IconChevronDown = (props: IconProps) => <Icon name="ChevronDown" {...props} />;
export const IconChevronLeft = (props: IconProps) => <Icon name="ChevronLeft" {...props} />;
export const IconChevronRight = (props: IconProps) => <Icon name="ChevronRight" {...props} />;
export const IconRefreshCw = (props: IconProps) => <Icon name="RefreshCw" {...props} />;
export const IconCalculator = (props: IconProps) => <Icon name="Calculator" {...props} />;
export const IconFlame = (props: IconProps) => <Icon name="Flame" {...props} />;
export const IconTrophy = (props: IconProps) => <Icon name="Trophy" {...props} />;
export const IconGlobe = (props: IconProps) => <Icon name="Globe" {...props} />;
export const IconSettings = (props: IconProps) => <Icon name="Settings" {...props} />;
export const IconEye = (props: IconProps) => <Icon name="Eye" {...props} />;
export const IconEyeOff = (props: IconProps) => <Icon name="EyeOff" {...props} />;
export const IconExternalLink = (props: IconProps) => <Icon name="ExternalLink" {...props} />;
export const IconPlus = (props: IconProps) => <Icon name="Plus" {...props} />;
export const IconMinus = (props: IconProps) => <Icon name="Minus" {...props} />;
export const IconSlidersHorizontal = (props: IconProps) => <Icon name="SlidersHorizontal" {...props} />;
export const IconSparkles = (props: IconProps) => <Icon name="Sparkles" {...props} />;
export const IconPlay = (props: IconProps) => <Icon name="Play" {...props} />;
export const IconPause = (props: IconProps) => <Icon name="Pause" {...props} />;
export const IconSend = (props: IconProps) => <Icon name="Send" {...props} />;
export const IconCopy = (props: IconProps) => <Icon name="Copy" {...props} />;
export const IconCheckCircle2 = (props: IconProps) => <Icon name="CheckCircle2" {...props} />;
export const IconXCircle = (props: IconProps) => <Icon name="XCircle" {...props} />;
export const IconHistory = (props: IconProps) => <Icon name="History" {...props} />;
export const IconLink2 = (props: IconProps) => <Icon name="Link2" {...props} />;
export const IconQrCode = (props: IconProps) => <Icon name="QrCode" {...props} />;
export const IconShieldAlert = (props: IconProps) => <Icon name="ShieldAlert" {...props} />;
export const IconInfo = (props: IconProps) => <Icon name="Info" {...props} />;
export const IconLightbulb = (props: IconProps) => <Icon name="Lightbulb" {...props} />;
export const IconLoader2 = (props: IconProps) => <Icon name="Loader2" {...props} />;
export const IconBot = (props: IconProps) => <Icon name="Bot" {...props} />;
export const IconBug = (props: IconProps) => <Icon name="Bug" {...props} />;
export const IconGift = (props: IconProps) => <Icon name="Gift" {...props} />;
export const IconMedal = (props: IconProps) => <Icon name="Medal" {...props} />;
export const IconMessageCircle = (props: IconProps) => <Icon name="MessageCircle" {...props} />;
export const IconMoreHorizontal = (props: IconProps) => <Icon name="MoreHorizontal" {...props} />;
export const IconScanLine = (props: IconProps) => <Icon name="ScanLine" {...props} />;
export const IconSmartphone = (props: IconProps) => <Icon name="Smartphone" {...props} />;
export const IconUsers = (props: IconProps) => <Icon name="Users" {...props} />;
export const IconCalendarDays = (props: IconProps) => <Icon name="CalendarDays" {...props} />;
export const IconCircleDollarSign = (props: IconProps) => <Icon name="CircleDollarSign" {...props} />;
export const IconGem = (props: IconProps) => <Icon name="Gem" {...props} />;
export const IconPartyPopper = (props: IconProps) => <Icon name="PartyPopper" {...props} />;
export const IconRocket = (props: IconProps) => <Icon name="Rocket" {...props} />;
export const IconSprout = (props: IconProps) => <Icon name="Sprout" {...props} />;
export const IconTarget = (props: IconProps) => <Icon name="Target" {...props} />;
export const IconPackage = (props: IconProps) => <Icon name="Package" {...props} />;
export const IconPalette = (props: IconProps) => <Icon name="Palette" {...props} />;
