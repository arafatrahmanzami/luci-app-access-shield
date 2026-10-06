include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-access-shield
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Arafat Rahman Zami <zamimondol@gmail.com>

LUCI_TITLE:=Access Shield — Device Access & Traffic Control
LUCI_DESCRIPTION:=MAC+IP whitelist enforcement, static DHCP, per-device traffic control, subnet limits, tickets, wireless MAC filter, and bandwidth monitor for OpenWrt 23.05+/24.10+
LUCI_DEPENDS:=+luci-base +nftables +kmod-nft-core
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,$(PKG_NAME)))
