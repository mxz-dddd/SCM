import { Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AttachmentWorkbench } from '../platform/AttachmentWorkbench';
import { ConfigurationWorkbench } from '../platform/ConfigurationWorkbench';
import { OrganizationRbacWorkbench } from '../platform/OrganizationRbacWorkbench';
import { MdmGovernanceWorkbench } from './MdmGovernanceWorkbench';
import { PartnerWorkbench } from './PartnerWorkbench';
import { ProductWorkbench } from './ProductWorkbench';
import { WarehouseFleetWorkbench } from './WarehouseFleetWorkbench';

export type MasterDataSection =
  | 'products'
  | 'partners'
  | 'regions'
  | 'capacity'
  | 'fleet'
  | 'charges'
  | 'organizations'
  | 'attachments'
  | 'settings';

const sections: readonly {
  key: MasterDataSection;
  label: string;
  path: string;
}[] = [
  { key: 'products', label: '货品', path: '/mdm/products' },
  { key: 'partners', label: '伙伴', path: '/mdm/partners' },
  { key: 'regions', label: '地域', path: '/mdm/regions' },
  { key: 'capacity', label: '运力', path: '/mdm/capacity' },
  { key: 'fleet', label: '车队', path: '/mdm/fleet' },
  { key: 'charges', label: '费用', path: '/mdm/charges' },
  { key: 'organizations', label: '组织', path: '/mdm/organizations' },
  { key: 'attachments', label: '附件', path: '/mdm/attachments' },
  { key: 'settings', label: '综合设置', path: '/mdm/settings' },
];

function SectionContent({ section }: { section: MasterDataSection }) {
  if (section === 'products') return <ProductWorkbench />;
  if (section === 'partners' || section === 'regions')
    return <PartnerWorkbench />;
  if (section === 'capacity' || section === 'fleet')
    return <WarehouseFleetWorkbench />;
  if (section === 'charges') return <MdmGovernanceWorkbench />;
  if (section === 'organizations') return <OrganizationRbacWorkbench />;
  if (section === 'attachments') return <AttachmentWorkbench />;
  return <ConfigurationWorkbench />;
}

export function MasterDataHub({
  initialSection,
}: {
  initialSection: MasterDataSection;
}) {
  const navigate = useNavigate();
  return (
    <section className="master-data-hub">
      <Typography.Title level={2}>主数据中心</Typography.Title>
      <Typography.Paragraph>
        货品、伙伴、地域、运力、车队、费用、组织、附件和综合设置均有稳定地址，并复用现有真实领域能力。
      </Typography.Paragraph>
      <Tabs
        activeKey={initialSection}
        items={sections.map(({ key, label }) => ({ key, label }))}
        onChange={(key) => {
          const section = sections.find((item) => item.key === key);
          if (section) void navigate(section.path);
        }}
      />
      <SectionContent section={initialSection} />
    </section>
  );
}

export const MasterProductsPage = () => (
  <MasterDataHub initialSection="products" />
);
export const MasterPartnersPage = () => (
  <MasterDataHub initialSection="partners" />
);
export const MasterRegionsPage = () => (
  <MasterDataHub initialSection="regions" />
);
export const MasterCapacityPage = () => (
  <MasterDataHub initialSection="capacity" />
);
export const MasterFleetPage = () => <MasterDataHub initialSection="fleet" />;
export const MasterChargesPage = () => (
  <MasterDataHub initialSection="charges" />
);
export const MasterOrganizationsPage = () => (
  <MasterDataHub initialSection="organizations" />
);
export const MasterAttachmentsPage = () => (
  <MasterDataHub initialSection="attachments" />
);
export const MasterSettingsPage = () => (
  <MasterDataHub initialSection="settings" />
);
