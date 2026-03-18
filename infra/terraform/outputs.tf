output "cluster_id" {
  value = oci_containerengine_cluster.nexthello.id
}

output "cluster_endpoint" {
  value = oci_containerengine_cluster.nexthello.endpoints[0].public_endpoint
}

output "vcn_id" {
  value = oci_core_vcn.nexthello.id
}

output "ocir_api_repo" {
  value = oci_artifacts_container_repository.api.display_name
}

output "ocir_whatsapp_repo" {
  value = oci_artifacts_container_repository.whatsapp.display_name
}

output "ocir_ui_repo" {
  value = oci_artifacts_container_repository.ui.display_name
}

output "node_pool_id" {
  value = oci_containerengine_node_pool.workers.id
}
