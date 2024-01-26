const express = require('express')

const router = new express.Router()
const config = require('../../../application/config')

router.get(
	'^/:404',
	async (req, res) => {
		res.render('error', {
			title: "48hr.email | 404",
			message: error.message,
			status: 404,
			address: req.params.address,
			stack: error.stack,
			madeby: config.branding[1],
			madebysite: config.branding[2]
		})
	}
)

module.exports = router
