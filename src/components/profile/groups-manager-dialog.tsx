import {
  AddRounded,
  DeleteRounded,
  ExpandMoreRounded,
  SaveRounded,
} from '@mui/icons-material'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { forwardRef, useImperativeHandle, useState } from 'react'

import { BaseDialog, DialogRef } from '@/components/base'
import { useProfiles } from '@/hooks/use-profiles'
import { useSubscriptionGroups } from '@/hooks/use-subscription-groups'
import { showNotice } from '@/services/notice-service'

export const GroupsManagerDialog = forwardRef<DialogRef>((_, ref) => {
  const [open, setOpen] = useState(false)
  const { profiles } = useProfiles()
  const { groups, addGroup, updateGroup, deleteGroup } = useSubscriptionGroups()

  // New group form state
  const [newName, setNewName] = useState('')
  const [newRemark, setNewRemark] = useState('')

  // Edit group states (in-memory changes for expanded accordion)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRemark, setEditRemark] = useState('')
  const [editUids, setEditUids] = useState<string[]>([])

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const profileItems = (profiles?.items || []).filter(
    (item) =>
      item &&
      item.uid &&
      (item.type === 'remote' || item.type === 'local') &&
      item.name,
  )

  const handleAccordionChange = (groupId: string, expanded: boolean) => {
    if (expanded) {
      const group = groups.find((g) => g.id === groupId)
      if (group) {
        setEditingGroupId(groupId)
        setEditName(group.name)
        setEditRemark(group.remark || '')
        setEditUids(group.uids)
      }
    } else {
      if (editingGroupId === groupId) {
        setEditingGroupId(null)
      }
    }
  }

  const handleCreateGroup = async () => {
    if (!newName.trim()) {
      showNotice.error('分组名称不能为空')
      return
    }
    try {
      await addGroup(newName.trim(), newRemark.trim())
      setNewName('')
      setNewRemark('')
      showNotice.success('分组创建成功')
    } catch (err) {
      showNotice.error(err)
    }
  }

  const handleSaveGroup = async (groupId: string) => {
    if (!editName.trim()) {
      showNotice.error('分组名称不能为空')
      return
    }
    try {
      await updateGroup(groupId, editName.trim(), editRemark.trim(), editUids)
      showNotice.success('分组更新成功')
    } catch (err) {
      showNotice.error(err)
    }
  }

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await deleteGroup(groupId)
      showNotice.success('分组删除成功')
      if (editingGroupId === groupId) {
        setEditingGroupId(null)
      }
    } catch (err) {
      showNotice.error(err)
    }
  }

  const handleCheckboxChange = (uid: string, checked: boolean) => {
    setEditUids((prev) => {
      if (checked) {
        return [...prev, uid]
      } else {
        return prev.filter((id) => id !== uid)
      }
    })
  }

  return (
    <BaseDialog
      open={open}
      title="订阅分组管理"
      contentSx={{
        width: { xs: '100%', sm: 600 },
        pb: 2,
        height: 1200,
        maxHeight: '95vh',
        display: 'flex',
        flexDirection: 'column',
      }}
      disableOk
      cancelBtn="关闭"
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <Box sx={{ mb: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {groups.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: 'center', my: 3 }}
          >
            暂无分组，请在下方创建一个新分组
          </Typography>
        ) : (
          groups.map((group) => {
            const isEditing = editingGroupId === group.id
            return (
              <Accordion
                key={group.id}
                expanded={isEditing}
                onChange={(_, expanded) =>
                  handleAccordionChange(group.id, expanded)
                }
                sx={{ mb: '6px', '&:before': { display: 'none' } }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreRounded />}
                  sx={{
                    minHeight: '40px !important',
                    height: 40,
                    '& .MuiAccordionSummary-content': {
                      margin: '0 !important',
                    },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      justifyContent: 'space-between',
                      width: '100%',
                      pr: 2,
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {group.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {group.uids.length} 个订阅
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <TextField
                      label="分组名称"
                      size="small"
                      fullWidth
                      value={isEditing ? editName : group.name}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <TextField
                      label="分组备注"
                      size="small"
                      fullWidth
                      value={isEditing ? editRemark : group.remark}
                      onChange={(e) => setEditRemark(e.target.value)}
                    />

                    <Divider />
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 600, color: 'text.secondary' }}
                    >
                      选择该分组内的订阅:
                    </Typography>

                    <FormGroup
                      row
                      sx={{
                        maxHeight: '480px',
                        overflowY: 'auto',
                        pl: 1,
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                      }}
                    >
                      {profileItems.map((item) => {
                        const uid = item.uid
                        const isChecked = isEditing
                          ? editUids.includes(uid)
                          : group.uids.includes(uid)
                        return (
                          <FormControlLabel
                            key={uid}
                            sx={{
                              width: '33.33%',
                              marginRight: 0,
                              boxSizing: 'border-box',
                              pr: 1.5,
                              '& .MuiFormControlLabel-label': {
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                width: '100%',
                              },
                            }}
                            control={
                              <Checkbox
                                size="small"
                                checked={isChecked}
                                onChange={(e) =>
                                  handleCheckboxChange(uid, e.target.checked)
                                }
                              />
                            }
                            label={
                              <Box
                                sx={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  width: '100%',
                                }}
                              >
                                <Typography
                                  variant="body2"
                                  noWrap
                                  title={item.name || '未命名配置'}
                                  sx={{ fontWeight: 500 }}
                                >
                                  {item.name || '未命名配置'}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  noWrap
                                  sx={{ fontSize: '10px' }}
                                  title={
                                    groups
                                      .filter((g) => g.uids.includes(uid))
                                      .map((g) => g.name).length > 0
                                      ? `所属分组: ${groups
                                          .filter((g) => g.uids.includes(uid))
                                          .map((g) => g.name)
                                          .join(', ')}`
                                      : '暂无分组'
                                  }
                                >
                                  {(() => {
                                    const belongs = groups
                                      .filter((g) => g.uids.includes(uid))
                                      .map((g) => g.name)
                                    return belongs.length > 0
                                      ? belongs.join(', ')
                                      : '无'
                                  })()}
                                </Typography>
                              </Box>
                            }
                          />
                        )
                      })}
                    </FormGroup>

                    <Divider />

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: 'flex-end' }}
                    >
                      <Button
                        size="small"
                        color="error"
                        variant="contained"
                        startIcon={<DeleteRounded />}
                        onClick={() => handleDeleteGroup(group.id)}
                      >
                        删除
                      </Button>
                      <Button
                        size="small"
                        color="primary"
                        variant="contained"
                        startIcon={<SaveRounded />}
                        onClick={() => handleSaveGroup(group.id)}
                      >
                        保存
                      </Button>
                    </Stack>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )
          })
        )}
      </Box>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
        新建分组
      </Typography>
      <Stack spacing={1.5}>
        <TextField
          label="新分组名称"
          size="small"
          fullWidth
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <TextField
          label="新分组备注（可选）"
          size="small"
          fullWidth
          value={newRemark}
          onChange={(e) => setNewRemark(e.target.value)}
        />
        <Button
          size="small"
          variant="contained"
          startIcon={<AddRounded />}
          onClick={handleCreateGroup}
          sx={{ alignSelf: 'flex-end' }}
        >
          创建分组
        </Button>
      </Stack>
    </BaseDialog>
  )
})

GroupsManagerDialog.displayName = 'GroupsManagerDialog'
